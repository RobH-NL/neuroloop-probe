// 1. GLOBAL TELEMETRY BUFFER
let sessionData = {
    session_id: "",
    participant_id: "",
    probe_phase: "",
    difficulty_lane: "",
    puzzle_archetype: "", 
    puzzle_seed: 0,
    timestamp_start: null,
    timestamp_end: null,
    completion_time_ms: 0,
    incorrect_moves: 0,
    resets_used: 0,
    completion_status: "abandoned"
};

let firstMoveLatencyRecorded = false;
let startTime = null;

// 2. PRNG ENGINE
function getSeedFromString(str) {
    let hash = 0;
    for (let i = 0; i < str.length; i++) {
        hash = str.charCodeAt(i) + ((hash << 5) - hash);
    }
    return Math.abs(hash);
}

function lcgRandom(seed) {
    const m = 2147483647;
    const a = 48271;
    const c = 0;
    let currentSeed = seed;
    return function() {
        currentSeed = (a * currentSeed + c) % m;
        return currentSeed / m;
    };
}

function switchScreen(screenId) {
    document.querySelectorAll('.screen').forEach(s => s.classList.remove('active'));
    document.getElementById(screenId).classList.add('active');
}

// 3. ARCHETYPE GENERATION REGISTRY
const ArchetypeGenerators = {
    gradient_numbers: function(size, nextRand) {
        let solution = Array.from({ length: size }, (_, i) => i);
        return {
            solution: solution,
            displayValues: solution.map(v => ({ id: v, label: String(v), rank: v }))
        };
    },

    alphabet_sequence: function(size, nextRand) {
        const alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZ";
        const maxStartIndex = alphabet.length - size;
        const startIndex = Math.floor(nextRand() * (maxStartIndex + 1));
        
        let displayValues = [];
        let solution = [];
        
        for (let i = 0; i < size; i++) {
            solution.push(i);
            displayValues.push({ id: i, label: alphabet[startIndex + i], rank: i });
        }
        return { solution, displayValues };
    },

    multiplication_matrix: function(size, nextRand) {
        const scalar = Math.floor(nextRand() * 8) + 2;
        
        let displayValues = [];
        let solution = [];
        
        for (let i = 1; i <= size; i++) {
            solution.push(i - 1);
            displayValues.push({ id: i - 1, label: String(i * scalar), rank: i - 1 });
        }
        return { solution, displayValues };
    }
};

// 4. CORE PUZZLE LIFECYCLE CONTROLLER
document.getElementById('btn-start').addEventListener('click', () => {
    sessionData.participant_id = document.getElementById('input-participant').value;
    sessionData.session_id = document.getElementById('input-session').value;
    sessionData.probe_phase = document.getElementById('select-phase').value;
    sessionData.difficulty_lane = document.getElementById('select-lane').value;
    sessionData.puzzle_archetype = document.getElementById('select-archetype').value;
    
    // Reset performance vectors for clean iteration runs
    sessionData.incorrect_moves = 0;
    sessionData.resets_used = 0;
    
    const basePairString = `${sessionData.participant_id}_${sessionData.session_id}_${sessionData.puzzle_archetype}`;
    let baseSeed = getSeedFromString(basePairString) % 2147483647;
    
    if (sessionData.probe_phase === 'post') {
        baseSeed = (48271 * baseSeed) % 2147483647; 
    }
    sessionData.puzzle_seed = baseSeed;

    initializePuzzle();
});

function initializePuzzle() {
    const lane = sessionData.difficulty_lane;
    const countMap = { easy: 3, medium: 5, hard: 7 };
    const totalPieces = countMap[lane];

    const nextRand = lcgRandom(sessionData.puzzle_seed);
    const generator = ArchetypeGenerators[sessionData.puzzle_archetype];
    const { solution, displayValues } = generator(totalPieces, nextRand);

    let scrambledIndices = [...solution];
    for (let i = scrambledIndices.length - 1; i > 0; i--) {
        const j = Math.floor(nextRand() * (i + 1));
        [scrambledIndices[i], scrambledIndices[j]] = [scrambledIndices[j], scrambledIndices[i]];
    }

    if (JSON.stringify(scrambledIndices) === JSON.stringify(solution)) {
        [scrambledIndices[0], scrambledIndices[scrambledIndices.length - 1]] = 
        [scrambledIndices[scrambledIndices.length - 1], scrambledIndices[0]];
    }

    let scrambledPieces = scrambledIndices.map(idx => displayValues.find(p => p.id === idx));

    renderGameboard(scrambledPieces, displayValues, solution);
    
    sessionData.timestamp_start = new Date().toISOString();
    startTime = performance.now();
    firstMoveLatencyRecorded = false;
    
    document.getElementById('meta-display').innerText = 
        `${sessionData.participant_id.toUpperCase()} | ${sessionData.session_id.toUpperCase()} | ${sessionData.probe_phase.toUpperCase()} [${sessionData.puzzle_archetype.toUpperCase()}]`;
    
    switchScreen('screen-puzzle');
}

let currentlySelectedPiece = null; 

function renderGameboard(scrambledPieces, displayValues, solution) {
    const bank = document.getElementById('scramble-bank');
    const targets = document.getElementById('target-slots');
    bank.innerHTML = '';
    targets.innerHTML = '';
    currentlySelectedPiece = null; 

    // 1. RENDER INTERACTIVE PIECES
    scrambledPieces.forEach((pieceData) => {
        const piece = document.createElement('div');
        piece.className = 'puzzle-piece';
        piece.draggable = true;
        piece.id = `piece-${pieceData.id}`;
        piece.dataset.value = pieceData.id;
        
        const greyScaleValue = Math.floor(200 - (pieceData.rank * (120 / solution.length)));
        piece.style.backgroundColor = `rgb(${greyScaleValue}, ${greyScaleValue}, ${greyScaleValue})`;
        piece.style.color = pieceData.rank > (solution.length / 2) ? '#fff' : '#000';
        piece.innerText = pieceData.label;

        // --- DESKTOP MOUSE DRAG EVENT ---
        piece.addEventListener('dragstart', (e) => {
            e.dataTransfer.setData('text/plain', piece.id);
            recordLatency();
        });

        // --- DESKTOP/MOBILE CLICK-TAP TO SELECT ---
        piece.addEventListener('click', (e) => {
            e.stopPropagation(); 
            recordLatency();

            if (piece.parentElement.classList.contains('target-slot')) {
                piece.classList.remove('selected');
                bank.appendChild(piece); 
                currentlySelectedPiece = null;
                checkPuzzleState(targets, solution);
                return;
            }

            document.querySelectorAll('.puzzle-piece').forEach(p => p.classList.remove('selected'));
            
            if (currentlySelectedPiece === piece) {
                currentlySelectedPiece = null; 
            } else {
                currentlySelectedPiece = piece;
                piece.classList.add('selected');
            }
        });

        // --- NATIVE IPAD TOUCH EXPANSION DRAG ENGINE ---
        let startX = 0, startY = 0;

        piece.addEventListener('touchstart', (e) => {
            recordLatency();
            const touch = e.touches[0];
            startX = touch.clientX;
            startY = touch.clientY;
            piece.classList.add('dragging');
            currentlySelectedPiece = piece;
        }, { passive: true });

        piece.addEventListener('touchmove', (e) => {
            if (!piece.classList.contains('dragging')) return;
            const touch = e.touches[0];
            
            // Calculate movement offset relative to original layout box anchors
            const deltaX = touch.clientX - startX;
            const deltaY = touch.clientY - startY;
            
            // Visually translate the element across coordinate planes smoothly
            piece.style.transform = `translate(${deltaX}px, ${deltaY}px)`;
        });

        piece.addEventListener('touchend', (e) => {
            piece.classList.remove('dragging');
            piece.style.transform = 'none'; // Clear position manipulation transform
            
            const touch = e.changedTouches[0];
            
            // Identify if the finger was released inside an empty target container
            const elementAtTouch = document.elementFromPoint(touch.clientX, touch.clientY);
            const targetSlot = elementAtTouch ? elementAtTouch.closest('.target-slot') : null;
            
            if (targetSlot && targetSlot.children.length === 0) {
                const targetIndex = parseInt(targetSlot.dataset.index, 10);
                targetSlot.appendChild(piece);
                evaluateSingleMove(piece, targetSlot, targetIndex);
                checkPuzzleState(targets, solution);
            } else {
                // Snap piece safely back up if released over invalid coordinates
                if (!piece.parentElement.classList.contains('target-slot')) {
                    bank.appendChild(piece);
                }
            }
            currentlySelectedPiece = null;
        });

        bank.appendChild(piece);
    });

    // 2. RENDER EMPTY TARGET PLACEMENT SLOTS
    solution.forEach((_, idx) => {
        const slot = document.createElement('div');
        slot.className = 'target-slot';
        slot.dataset.index = idx;

        slot.addEventListener('dragover', (e) => e.preventDefault());
        slot.addEventListener('drop', (e) => {
            e.preventDefault();
            const pieceId = e.dataTransfer.getData('text/plain');
            const piece = document.getElementById(pieceId);
            
            if (slot.children.length === 0 && piece) {
                slot.appendChild(piece);
                piece.classList.remove('selected');
                
                evaluateSingleMove(piece, slot, idx);
                checkPuzzleState(targets, solution);
            }
        });

        slot.addEventListener('click', () => {
            if (currentlySelectedPiece && slot.children.length === 0) {
                const targetPiece = currentlySelectedPiece;
                slot.appendChild(targetPiece);
                targetPiece.classList.remove('selected');
                currentlySelectedPiece = null; 
                
                evaluateSingleMove(targetPiece, slot, idx);
                checkPuzzleState(targets, solution);
            }
        });

        targets.appendChild(slot);
    });
    
    document.body.onclick = () => {
        document.querySelectorAll('.puzzle-piece').forEach(p => p.classList.remove('selected'));
        currentlySelectedPiece = null;
    };
}

function checkPuzzleState(targetContainer, solution) {
    const slots = targetContainer.querySelectorAll('.target-slot');
    let filledCount = 0;
    let currentSequence = [];

    slots.forEach((slot) => {
        if (slot.children.length > 0) {
            filledCount++;
            currentSequence.push(parseInt(slot.children[0].dataset.value, 10));
        }
    });

    // Solve conditional match verification: verify all slots are filled AND ordered perfectly 0 to N-1
    if (filledCount === solution.length) {
        const isPerfectMatch = currentSequence.every((val, index) => val === index);
        if (isPerfectMatch) {
            executePuzzleTeardown("completed");
        }
    }
}

document.getElementById('btn-reset').addEventListener('click', () => {
    sessionData.resets_used++;
    initializePuzzle();
});

function executePuzzleTeardown(status) {
    sessionData.timestamp_end = new Date().toISOString();
    sessionData.completion_time_ms = Math.round(performance.now() - startTime);
    sessionData.completion_status = status;

    const runKey = `probe_${sessionData.participant_id}_${sessionData.session_id}_${sessionData.probe_phase}`;
    localStorage.setItem(runKey, JSON.stringify({...sessionData}));

    document.getElementById('telemetry-summary').innerHTML = `
        <pre>${JSON.stringify(sessionData, null, 2)}</pre>
    `;
    
    calculateSessionDeltas();
    switchScreen('screen-solved');
}

function calculateSessionDeltas() {
    const currentPid = sessionData.participant_id;
    const currentSid = sessionData.session_id;
    
    const targetOppositePhase = sessionData.probe_phase === 'pre' ? 'post' : 'pre';
    const parallelKey = `probe_${currentPid}_${currentSid}_${targetOppositePhase}`;
    const parallelRawData = localStorage.getItem(parallelKey);
    
    const displayContainer = document.getElementById('delta-metrics-grid');
    
    if (!parallelRawData) {
        displayContainer.innerHTML = `
            <p class="neutral-msg">Phase <strong>${sessionData.probe_phase.toUpperCase()}</strong> captured. Complete the <strong>${targetOppositePhase.toUpperCase()}</strong> phase using Session ID <strong>${currentSid}</strong> to render comparative behavioral indicators.</p>
        `;
        return;
    }
    
    const parallelData = JSON.parse(parallelRawData);
    const preRun = sessionData.probe_phase === 'pre' ? sessionData : parallelData;
    const postRun = sessionData.probe_phase === 'post' ? sessionData : parallelData;
    
    const timeDelta = postRun.completion_time_ms - preRun.completion_time_ms;
    const moveDelta = postRun.incorrect_moves - preRun.incorrect_moves;
    const latencyDelta = (postRun.first_move_latency_ms || 0) - (preRun.first_move_latency_ms || 0);

    displayContainer.innerHTML = `
        <div class="delta-card-grid">
            <div class="delta-card">
                <span class="delta-label">Completion Time Delta</span>
                <div class="delta-value ${timeDelta <= 0 ? 'improvement' : 'regression'}">
                    ${timeDelta <= 0 ? '' : '+'}${Math.round(timeDelta / 10) / 100}s
                </div>
            </div>
            <div class="delta-card">
                <span class="delta-label">Incorrect Moves Delta</span>
                <div class="delta-value ${moveDelta <= 0 ? 'improvement' : 'regression'}">
                    ${moveDelta <= 0 ? '' : '+'}${moveDelta}
                </div>
            </div>
            <div class="delta-card">
                <span class="delta-label">Task Initiation Shift</span>
                <div class="delta-value ${latencyDelta <= 0 ? 'improvement' : 'regression'}">
                    ${latencyDelta <= 0 ? '' : '+'}${latencyDelta}ms
                </div>
            </div>
            <div class="delta-card">
                <span class="delta-label">Matching Base Seed</span>
                <div class="delta-value stable" style="font-size: 0.9rem;">
                    ${preRun.puzzle_seed}
                </div>
            </div>
        </div>
        <p class="neutral-msg" style="font-size: 0.75rem;">
            * Treat variations as exploratory functional indicators for within-person trends across blocks. Do not isolate a single run as diagnostic.
        </p>
    `;
}

function recordLatency() {
    if (!firstMoveLatencyRecorded) {
        sessionData.first_move_latency_ms = Math.round(performance.now() - startTime);
        firstMoveLatencyRecorded = true;
    }
}

document.getElementById('btn-export').addEventListener('click', () => {
    const dataStr = "data:text/json;charset=utf-8," + encodeURIComponent(JSON.stringify(sessionData));
    const dlAnchorElem = document.createElement('a');
    dlAnchorElem.setAttribute("href", dataStr);
    dlAnchorElem.setAttribute("download", `neuroloop_probe_${sessionData.participant_id}.json`);
    dlAnchorElem.click();
});

document.getElementById('btn-restart').addEventListener('click', () => {
    switchScreen('screen-setup');
});
