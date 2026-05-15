const $ = (id) => document.getElementById(id);

const state = {
    text: "",
    steps: [],
    tokens: [],
    stats: null,
    stepIdx: 0,
    playing: false,
    playTimer: null,
    chartSize: null,
    currentFile: null,
    compressedBlob: null,
    compressedName: null,
};

const SAMPLES = [
    "abracadabra abracadabra abracadabra",
    "TOBEORNOTTOBEORTOBEORNOT",
    "Съешь же ещё этих мягких французских булок, да выпей чаю.",
    "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
    "if (x == y) { return x; } else { return y; }",
];

// ---------- Tabs ----------
document.querySelectorAll(".tab").forEach((tab) => {
    tab.addEventListener("click", () => {
        const t = tab.dataset.tab;
        document.querySelectorAll(".tab").forEach((x) => x.classList.toggle("active", x === tab));
        document.querySelectorAll(".tab-content").forEach((x) => {
            x.hidden = x.dataset.tab !== t;
        });
        // При переключении вкладок старая статистика теряет смысл
        resetUI();
    });
});

// ---------- Top buttons ----------
$("btnSample").addEventListener("click", () => {
    $("input").value = SAMPLES[Math.floor(Math.random() * SAMPLES.length)];
});
$("btnClear").addEventListener("click", () => {
    $("input").value = "";
    resetFileUI();
    resetUI();
});
$("btnHelp").addEventListener("click", () => { $("helpModal").hidden = false; });
$("btnHelpClose").addEventListener("click", () => { $("helpModal").hidden = true; });
$("helpModal").addEventListener("click", (e) => {
    if (e.target.id === "helpModal") $("helpModal").hidden = true;
});

// ---------- Text encode ----------
$("btnEncode").addEventListener("click", encodeText);

// ---------- Step controls ----------
$("btnFirst").addEventListener("click", () => goStep(0));
$("btnPrev").addEventListener("click", () => goStep(state.stepIdx - 1));
$("btnNext").addEventListener("click", () => goStep(state.stepIdx + 1));
$("btnLast").addEventListener("click", () => goStep(state.steps.length - 1));
$("btnPlay").addEventListener("click", togglePlay);

document.addEventListener("keydown", (e) => {
    if (e.target.tagName === "TEXTAREA" || e.target.tagName === "INPUT") return;
    if (!$("helpModal").hidden && e.key === "Escape") { $("helpModal").hidden = true; return; }
    if (e.key === "ArrowLeft") goStep(state.stepIdx - 1);
    if (e.key === "ArrowRight") goStep(state.stepIdx + 1);
    if (e.key === " ") { e.preventDefault(); togglePlay(); }
});

// ---------- File upload ----------
const fileZone = $("fileZone");
const fileInput = $("fileInput");

fileZone.addEventListener("click", () => fileInput.click());
$("btnBrowse").addEventListener("click", (e) => { e.stopPropagation(); fileInput.click(); });
fileInput.addEventListener("change", (e) => handleFile(e.target.files[0]));

["dragenter", "dragover"].forEach((ev) =>
    fileZone.addEventListener(ev, (e) => { e.preventDefault(); fileZone.classList.add("drag"); })
);
["dragleave", "drop"].forEach((ev) =>
    fileZone.addEventListener(ev, (e) => { e.preventDefault(); fileZone.classList.remove("drag"); })
);
fileZone.addEventListener("drop", (e) => {
    if (e.dataTransfer.files.length) handleFile(e.dataTransfer.files[0]);
});

function handleFile(f) {
    if (!f) return;
    state.currentFile = f;
    const status = $("fileStatus");
    status.hidden = false;
    status.innerHTML = `<span class="fname">${escapeHtml(f.name)}</span><span class="fsize">${fmtBytes(f.size)}</span>`;
    $("btnCompressFile").disabled = false;
    $("fileActions").hidden = true;
    state.compressedBlob = null;
    // Сбросить input.value, чтобы повторный выбор того же файла снова срабатывал
    fileInput.value = "";
}

function resetFileUI() {
    state.currentFile = null;
    state.compressedBlob = null;
    state.compressedName = null;
    $("fileStatus").hidden = true;
    $("fileStatus").innerHTML = "";
    $("fileActions").hidden = true;
    $("btnCompressFile").disabled = true;
    fileInput.value = "";
}

$("btnCompressFile").addEventListener("click", compressFile);
$("btnDownload").addEventListener("click", () => {
    if (!state.compressedBlob) return;
    const url = URL.createObjectURL(state.compressedBlob);
    const a = document.createElement("a");
    a.href = url;
    a.download = state.compressedName;
    a.click();
    URL.revokeObjectURL(url);
});
$("btnDecompressFile").addEventListener("click", decompressFile);

async function compressFile() {
    if (!state.currentFile) return;
    const fd = new FormData();
    fd.append("file", state.currentFile);
    fd.append("search_size", $("fSearchSize").value);
    fd.append("lookahead_size", $("fLookaheadSize").value);

    $("btnCompressFile").disabled = true;
    $("btnCompressFile").textContent = "Сжимаем…";
    try {
        const res = await fetch("/api/compress-file", { method: "POST", body: fd });
        if (!res.ok) { alert("Ошибка: " + (await res.text())); return; }
        const blob = await res.blob();
        state.compressedBlob = blob;
        state.compressedName = (state.currentFile.name || "input") + ".lz77";

        const origSize = +res.headers.get("X-Original-Size");
        const compSize = +res.headers.get("X-Compressed-Size");
        const tokens = +res.headers.get("X-Token-Count");
        state.stats = {
            original_size_bytes: origSize,
            compressed_size_bytes: compSize,
            original_size_bits: origSize * 8,
            compressed_size_bits: compSize * 8,
            compression_ratio: compSize / origSize,
            space_saving: 1 - compSize / origSize,
            token_count: tokens,
        };
        renderStats();
        renderSizeChart();
        $("fileActions").hidden = false;
    } finally {
        $("btnCompressFile").disabled = false;
        $("btnCompressFile").textContent = "Сжать файл";
    }
}

async function decompressFile() {
    const inp = document.createElement("input");
    inp.type = "file";
    inp.accept = ".lz77";
    inp.onchange = async () => {
        const f = inp.files[0];
        if (!f) return;
        const fd = new FormData();
        fd.append("file", f);
        const res = await fetch("/api/decompress-file", { method: "POST", body: fd });
        if (!res.ok) { alert("Ошибка: " + (await res.text())); return; }
        const blob = await res.blob();
        const url = URL.createObjectURL(blob);
        const a = document.createElement("a");
        a.href = url;
        a.download = f.name.replace(/\.lz77$/, "") || "decompressed.bin";
        a.click();
        URL.revokeObjectURL(url);
    };
    inp.click();
}

// ---------- Text encode flow ----------
async function encodeText() {
    const text = $("input").value;
    if (!text) return;
    const searchSize = +$("searchSize").value;
    const lookaheadSize = +$("lookaheadSize").value;

    const res = await fetch("/api/encode", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ text, search_size: searchSize, lookahead_size: lookaheadSize }),
    });
    if (!res.ok) { alert("Ошибка кодирования"); return; }
    const data = await res.json();

    state.text = text;
    state.tokens = data.tokens;
    state.steps = data.steps;
    state.stats = data.stats;
    state.stepIdx = 0;

    renderStats();
    renderSizeChart();
    renderTokens();
    goStep(0);
}

// ---------- Step rendering ----------
function goStep(idx) {
    if (state.steps.length === 0) return;
    idx = Math.max(0, Math.min(state.steps.length - 1, idx));
    state.stepIdx = idx;
    renderStep(state.steps[idx]);
    $("stepCounter").textContent = `${idx + 1} / ${state.steps.length}`;
    document.querySelectorAll(".token-chip").forEach((el, i) => {
        el.classList.toggle("active", i === idx);
    });
    const active = document.querySelector(".token-chip.active");
    if (active) active.scrollIntoView({ block: "nearest", behavior: "smooth" });
}

function togglePlay() {
    if (state.steps.length === 0) return;
    if (state.playing) {
        clearInterval(state.playTimer);
        state.playing = false;
        $("btnPlay").textContent = "▶";
    } else {
        state.playing = true;
        $("btnPlay").textContent = "⏸";
        state.playTimer = setInterval(() => {
            if (state.stepIdx >= state.steps.length - 1) { togglePlay(); return; }
            goStep(state.stepIdx + 1);
        }, 500);
    }
}

function renderStep(step) {
    const container = $("windowContent");
    container.innerHTML = "";

    const search = step.search_buffer;
    const lookahead = step.lookahead_buffer;
    const matchLen = step.match_length;
    const nextChar = step.next_char;

    // Подсветка совпадения внутри search-буфера
    if (matchLen > 0 && step.match_offset > 0) {
        const matchStartInSearch = search.length - step.match_offset;
        for (let i = 0; i < search.length; i++) {
            const inMatch = i >= matchStartInSearch && i < matchStartInSearch + Math.min(matchLen, step.match_offset);
            container.appendChild(makeCh(search[i], inMatch ? "match" : "search"));
        }
    } else {
        for (const c of search) container.appendChild(makeCh(c, "search"));
    }

    // Разделитель курсора
    const sep = document.createElement("span");
    sep.className = "ch cursor";
    sep.textContent = "▸";
    sep.title = "курсор";
    container.appendChild(sep);

    for (let i = 0; i < lookahead.length; i++) {
        let cls = "lookahead";
        if (i < matchLen) cls = "matched-look";
        else if (i === matchLen && nextChar) cls = "next-char";
        container.appendChild(makeCh(lookahead[i], cls));
    }

    $("matchInfo").textContent = matchLen > 0
        ? `offset=${step.match_offset}, length=${matchLen}`
        : "литерал (нет совпадения)";
    $("tokenInfo").textContent = `(${step.token.offset}, ${step.token.length}, '${escapeDisplay(step.token.next_char)}')`;
    $("cursorInfo").textContent = `${step.cursor} / ${state.text.length}`;
}

function makeCh(ch, cls) {
    const el = document.createElement("span");
    el.className = `ch ${cls}`;
    el.textContent = ch === " " ? "·" : ch === "\n" ? "↵" : ch === "\t" ? "→" : ch;
    return el;
}

function escapeDisplay(s) {
    return s.replace(/ /g, "·").replace(/\n/g, "↵").replace(/\t/g, "→");
}

function escapeHtml(s) {
    return s.replace(/[&<>"']/g, (c) => ({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]));
}

function fmtBytes(n) {
    if (n < 1024) return n + " Б";
    if (n < 1024 * 1024) return (n / 1024).toFixed(1) + " КБ";
    return (n / 1024 / 1024).toFixed(2) + " МБ";
}

// ---------- Stats + chart ----------
function renderStats() {
    const s = state.stats;
    $("statOrig").textContent = fmtBytes(s.original_size_bytes);
    $("statComp").textContent = fmtBytes(s.compressed_size_bytes);
    const saving = (s.space_saving * 100).toFixed(1);
    $("statSaving").textContent = `${saving}%`;
    $("statSaving").style.color = s.space_saving > 0 ? "var(--green)" : "var(--red)";
    $("statTokens").textContent = s.token_count;
    $("tokensCount").textContent = `${s.token_count} токенов`;
}

function renderSizeChart() {
    const s = state.stats;
    const ctx = document.getElementById("chartSize").getContext("2d");
    if (state.chartSize) state.chartSize.destroy();

    Chart.defaults.color = "#9aa3b8";
    Chart.defaults.borderColor = "#2a3046";
    Chart.defaults.font.family = "'JetBrains Mono', monospace";
    Chart.defaults.font.size = 10;

    state.chartSize = new Chart(ctx, {
        type: "bar",
        data: {
            labels: ["Исходный", "Сжатый"],
            datasets: [{
                data: [s.original_size_bytes, s.compressed_size_bytes],
                backgroundColor: ["rgba(122,162,247,0.5)", "rgba(158,206,106,0.5)"],
                borderColor: ["#7aa2f7", "#9ece6a"],
                borderWidth: 2,
                borderRadius: 6,
            }],
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            indexAxis: "y",
            plugins: {
                legend: { display: false },
                tooltip: { callbacks: { label: (c) => fmtBytes(c.parsed.x) } },
            },
            scales: {
                x: { beginAtZero: true, ticks: { callback: (v) => fmtBytes(v) }, grid: { color: "rgba(255,255,255,0.04)" } },
                y: { grid: { display: false } },
            },
        },
    });
}

function renderTokens() {
    const list = $("tokensList");
    list.innerHTML = "";
    state.tokens.forEach((t, i) => {
        const el = document.createElement("div");
        el.className = "token-chip";
        const nc = t.next_char ? escapeHtml(escapeDisplay(t.next_char)) : "";
        el.innerHTML = `<span class="num">${i + 1}</span>·(<span class="num">${t.offset}</span>,<span class="num">${t.length}</span>,<span class="lit">'${nc}'</span>)`;
        el.addEventListener("click", () => goStep(i));
        list.appendChild(el);
    });
}

function resetUI() {
    state.steps = [];
    state.tokens = [];
    state.stats = null;
    state.stepIdx = 0;
    $("windowContent").innerHTML = '<span class="hint">Нажмите «Сжать», чтобы начать.</span>';
    $("tokensList").innerHTML = '<span class="hint">После сжатия здесь появятся токены.</span>';
    $("stepCounter").textContent = "—";
    $("matchInfo").textContent = "—";
    $("tokenInfo").textContent = "—";
    $("cursorInfo").textContent = "—";
    $("tokensCount").textContent = "";
    ["statOrig", "statComp", "statSaving", "statTokens"].forEach((id) => $(id).textContent = "—");
    if (state.chartSize) { state.chartSize.destroy(); state.chartSize = null; }
}
