// 1. GLOBAL TELEMETRY BUFFER
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
    completion_status: "abandoned",
    first_move_latency_ms: 0,
    survey_duration_ms: 0,
    baseline_questions_pre: null,  // FIXED: Explicit structural paths for compiler JSON serialization
    baseline_questions_post: null  // FIXED: Explicit structural paths for compiler JSON serialization
};

// --- QUESTIONNAIRE CONFIGURATION ---

const questionnaireMatrix = [
    { id: "mind_state", label: "Mind State (1: Calm, 5: Racing)", min: 1, max: 5, type: "range" },
    { id: "body_tension", label: "Body Tension (1: Relaxed, 5: Tense)", min: 1, max: 5, type: "range" },
    { id: "energy_level", label: "Energy Level (1: Exhausted, 5: Energized)", min: 1, max: 5, type: "range" },
    { id: "substance_intake", label: "Stimulants/Nicotine/Caffeine (Past 4 hrs)?", type: "toggle" },
    { id: "session_intent", label: "Session Intent (Focus Goal)", type: "text" } // Conditionally stripped out on Post-phase
];

let questionStartTime = 0;
let currentPhase = 'pre'; 

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
    document.querySelectorAll('.screen').forEach(s => {
        s.classList.remove('active');
        s.style.display = 'none'; 
    });

    const targetScreen = document.getElementById(screenId);
    if (targetScreen) {
        targetScreen.classList.add('active');
        targetScreen.style.display = 'block'; 
    } else {
        console.error(`Neuroloop: Could not find screen with ID ${screenId}`);
    }
}

function showQuestionnaire(phase) {
    currentPhase = phase;
    
    // Dynamically manipulate UI Titles based on Phase Routing context
    const titleEl = document.querySelector('#screen-questions h2');
    if (titleEl) {
        titleEl.innerText = phase === 'pre' ? 'Pre-Session Baseline Check-in' : 'Post-Session Checkout';
    }
    
    let container = document.getElementById('questions-container');
    if (!container) {
        console.warn("Neuroloop: 'questions-container' was missing from HTML. Auto-generating it.");
        container = document.createElement('div');
        container.id = 'questions-container';
        const submitBtn = document.getElementById('btn-submit-questions');
        if (submitBtn) {
            submitBtn.parentNode.insertBefore(container, submitBtn);
        } else {
            return;
        }
    }
    
    container.innerHTML = ''; 

    questionnaireMatrix.forEach(q => {
        // FIXED: Do not render or evaluate the "session_intent" (Intent field) if evaluating Post-Session profile
        if (phase === 'post' && q.id === 'session_intent') {
            return;
        }

        const block = document.createElement('div');
        block.className = 'question-block';
        block.style.marginBottom = '24px';
        block.style.display = 'flex';
        block.style.flexDirection = 'column';
        block.style.alignItems = 'center';
        block.style.color = '#ffffff';

        const label = document.createElement('label');
        label.style.marginBottom = '8px';
        label.innerText = q.label;
        block.appendChild(label);

        if (q.type === "range") {
            const flex = document.createElement('div');
            flex.style.display = 'flex'; flex.style.gap = '15px'; flex.style.width = '100%'; flex.style.maxWidth = '300px';
            const slider = document.createElement('input');
            slider.type = 'range'; slider.id = `q_${q.id}`; slider.min = q.min; slider.max = q.max; slider.value = 3; slider.style.width = '100%';
            const valSpan = document.createElement('span'); valSpan.id = `val_${q.id}`; valSpan.innerText = '3';
            flex.appendChild(slider); flex.appendChild(valSpan);
            block.appendChild(flex);
            slider.addEventListener('input', (e) => valSpan.innerText = e.target.value);
        } 
        else if (q.type === "toggle") {
            const toggle = document.createElement('input');
            toggle.type = 'checkbox'; toggle.id = `q_${q.id}`;
            toggle.style.width = '30px'; toggle.style.height = '30px';
            block.appendChild(toggle);
        } 
        else if (q.type === "text") {
            const textarea = document.createElement('textarea');
            textarea.id = `q_${q.id}`; textarea.rows = 3;
            textarea.style.width = '100%'; textarea.style.maxWidth = '300px'; textarea.style.padding = '8px';
            block.appendChild(textarea);
        }
        container.appendChild(block);
    });

    switchScreen('screen-questions'); 
    questionStartTime = performance.now();
}

// --- SUBMISSION ROUTER LOGIC ---
document.getElementById('btn-submit-questions').addEventListener('click', () => {
    const duration = performance.now() - questionStartTime;
    sessionData.survey_duration_ms = (sessionData.survey_duration_ms || 0) + duration;

    const answers = {};
    questionnaireMatrix.forEach(q => {
        // Skip extraction for layout entities omitted in post conditions
        if (currentPhase === 'post' && q.id === 'session_intent') return;

        const el = document.getElementById(`q_${q.id}`);
        if (!el) return;

        if (q.type === "toggle") {
            answers[q.id] = el.checked;
        } else if (q.type === "range") {
            answers[q.id] = parseInt(el.value, 10);
        } else {
            answers[q.id] = el.value;
        }
    });

    if (currentPhase === 'pre') {
        sessionData.baseline_questions_pre = answers;
        executePuzzleStart(); 
    } else {
        sessionData.baseline_questions_post = answers;
        // Commit finalized array tracking with both questions saved down to memory
        const runKey = `probe_${sessionData.participant_id}_${sessionData.session_id}_${sessionData.probe_phase}`;
        localStorage.setItem(runKey, JSON.stringify({...sessionData}));
        
        // Render view telemetry text explicitly down on targets before flipping view
        document.getElementById('telemetry-summary').innerHTML = `<pre>${JSON.stringify(sessionData, null, 2)}</pre>`;
        switchScreen('screen-solved'); 
    }
});

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

// 4. CORE LIFECYCLE CONTROLLER

// INITIAL RUN FLOW TRIGGER
document.getElementById('btn-start').addEventListener('click', () => {
    const selectedPhase = document.getElementById('select-phase').value;
    
    // FIXED: Form Setup Verification Context Engine.
    // Pre-Session needs baseline data processing; Post-Session skips initial onboarding completely.
    if (selectedPhase === 'pre') {
        showQuestionnaire('pre');
    } else {
        // Clear old structural flags from buffer memory array mapping definitions
        sessionData.baseline_questions_pre = null;
        sessionData.baseline_questions_post = null;
        executePuzzleStart();
    }
});

function executePuzzleStart() {
    sessionData.participant_id = document.getElementById('input-participant').value;
    sessionData.session_id = document.getElementById('input-session').value;
    sessionData.probe_phase = document.getElementById('select-phase').value;
    sessionData.difficulty_lane = document.getElementById('select-lane').value;
    sessionData.puzzle_archetype = document.getElementById('select-archetype').value;
    
    sessionData.incorrect_moves = 0;
    sessionData.resets_used = 0;
    sessionData.survey_duration_ms = sessionData.probe_phase === 'post' ? 0 : sessionData.survey_duration_ms;
    
    // --- NEW: LINK PRE-SESSION DATA TO POST-SESSION RUNS ---
    if (sessionData.probe_phase === 'post') {
        // Look up the corresponding pre-session run in storage
        const preKey = `probe_${sessionData.participant_id}_${sessionData.session_id}_pre`;
        const preRawData = localStorage.getItem(preKey);
        
        if (preRawData) {
            try {
                const preDataParsed = JSON.parse(preRawData);
                // Pull the baseline survey data forward into the active session block
                sessionData.baseline_questions_pre = preDataParsed.baseline_questions_pre;
            } catch (e) {
                console.error("Neuroloop: Failed to parse historical baseline indicators.", e);
            }
        }
    }
    // --------------------------------------------------------

    const basePairString = `${sessionData.participant_id}_${sessionData.session_id}_${sessionData.puzzle_archetype}`;
    let baseSeed = getSeedFromString(basePairString) % 2147483647;
    
    if (sessionData.probe_phase === 'post') {
        baseSeed = (48271 * baseSeed) % 2147483647; 
    }
    sessionData.puzzle_seed = baseSeed;

    initializePuzzle();
}

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

        piece.addEventListener('dragstart', (e) => {
            e.dataTransfer.setData('text/plain', piece.id);
            recordLatency();
        });

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
            const deltaX = touch.clientX - startX;
            const deltaY = touch.clientY - startY;
            piece.style.transform = `translate(${deltaX}px, ${deltaY}px)`;
        });

        piece.addEventListener('touchend', (e) => {
            piece.classList.remove('dragging');
            piece.style.transform = 'none'; 
            
            const touch = e.changedTouches[0];
            const clientX = touch.clientX;
            const clientY = touch.clientY;
            
            let assignedSlot = null;
            const currentSlots = targets.querySelectorAll('.target-slot');
            
            for (let slot of currentSlots) {
                const rect = slot.getBoundingClientRect();
                if (clientX >= rect.left && clientX <= rect.right &&
                    clientY >= rect.top && clientY <= rect.bottom) {
                    assignedSlot = slot;
                    break;
                }
            }
            
            if (assignedSlot && assignedSlot.children.length === 0) {
                const targetIndex = parseInt(assignedSlot.dataset.index, 10);
                assignedSlot.appendChild(piece);
                evaluateSingleMove(piece, assignedSlot, targetIndex);
                checkPuzzleState(targets, solution);
            } else {
                if (!piece.parentElement.classList.contains('target-slot')) {
                    bank.appendChild(piece);
                }
            }
            currentlySelectedPiece = null;
        });

        bank.appendChild(piece);
    });

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

        slot.addEventListener('click', (e) => {
            e.stopPropagation(); 
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
}

function evaluateSingleMove(piece, slot, slotIndex) {
    const pieceValue = parseInt(piece.dataset.value, 10);
    if (pieceValue !== slotIndex) {
        sessionData.incorrect_moves++;
    }
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

    if (filledCount === solution.length) {
        const isPerfectMatch = currentSequence.every((val, index) => val === index);
        if (isPerfectMatch) {
            setTimeout(() => {
                currentlySelectedPiece = null;
                executePuzzleTeardown("completed");
            }, 50);
        }
    }
}

document.addEventListener('click', (e) => {
    const isPiece = e.target.classList.contains('puzzle-piece');
    const isSlot = e.target.classList.contains('target-slot');
    if (!isPiece && !isSlot) {
        document.querySelectorAll('.puzzle-piece').forEach(p => p.classList.remove('selected'));
        currentlySelectedPiece = null;
    }
});

document.getElementById('btn-reset').addEventListener('click', () => {
    sessionData.resets_used++;
    initializePuzzle();
});

function executePuzzleTeardown(status) {
    sessionData.timestamp_end = new Date().toISOString();
    sessionData.completion_time_ms = Math.round(performance.now() - startTime);
    sessionData.completion_status = status;

    // Save temporary state metrics down immediately
    const runKey = `probe_${sessionData.participant_id}_${sessionData.session_id}_${sessionData.probe_phase}`;
    localStorage.setItem(runKey, JSON.stringify({...sessionData}));

    document.getElementById('telemetry-summary').innerHTML = `
        <pre>${JSON.stringify(sessionData, null, 2)}</pre>
    `;
    
    calculateSessionDeltas();
    
    // FIXED: Instead of hijacking the completion UI loop with the questionnaire immediately,
    // evaluate the state logic. Pre-Session routes to dashboard. Post-Session routes to survey.
    if (sessionData.probe_phase === 'post') {
        showQuestionnaire('post');
    } else {
        switchScreen('screen-solved');
    }
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
