let pyodideReadyPromise = loadPyodide();

// store outputs for download buttons
let lastHtmlOutput = null;
let lastCsvOutput = null;
let lastPerLineCsv = null;
let lastPerLineData = null;

// sorting state
let perLineSort = { col: "line", asc: true };

/* ----------------------------
   RUN BUTTON ENABLE / DISABLE
----------------------------- */

function updateRunButtonState() {
    const intra  = document.getElementById("detectIntra").checked;
    const inter  = document.getElementById("detectInter").checked;
    const across = document.getElementById("detectAcross").checked;

    document.getElementById("runBtn").disabled = !(intra || inter || across);
}

document.addEventListener("DOMContentLoaded", () => {
    updateRunButtonState();

    ["detectIntra", "detectInter", "detectAcross"].forEach(id => {
        document.getElementById(id).addEventListener("change", updateRunButtonState);
    });
});

/* ----------------------------
   CSV → HIATUS COUNTS
----------------------------- */

function countHiatusFromCsv(csvText) {
    const lines = csvText.trim().split("\n");
    lines.shift();

    const counts = { I: 0, B: 0, V: 0, total: 0 };

    for (const line of lines) {
        if (!line.trim()) continue;
        const kind = line.split(",")[1];
        if (counts[kind] !== undefined) {
            counts[kind]++;
            counts.total++;
        }
    }
    return counts;
}

/* ----------------------------
   CSV → PER-LINE COUNTS
----------------------------- */

function countHiatusPerLine(csvText, lineCount) {
    const perLine = {};
    for (let i = 1; i <= lineCount; i++) perLine[i] = 0;

    const rows = csvText.trim().split("\n");
    rows.shift();

    for (const row of rows) {
        if (!row.trim()) continue;
        const field = row.split(",")[2];
        if (!field) continue;

        if (field.includes("-")) {
            const [a, b] = field.split("-").map(Number);
            if (perLine[a] !== undefined) perLine[a]++;
            if (perLine[b] !== undefined) perLine[b]++;
        } else {
            const n = parseInt(field, 10);
            if (perLine[n] !== undefined) perLine[n]++;
        }
    }
    return perLine;
}

function heatColor(value, max) {
    if (max === 0) return "#ffffff";
    const t = value / max;
    return `rgb(255, ${Math.round(255 * (1 - t))}, ${Math.round(255 * (1 - t))})`;
}

/* ----------------------------
   SORTABLE PER-LINE TABLE
----------------------------- */

function renderSparklineFromData(data, opts = {}) {
    if (!data || data.length === 0) return "";

    const {
        width = 720,
        height = 160,
        margin = { top: 10, right: 20, bottom: 35, left: 45 },
        maxPoints = 300
    } = opts;

    const rawValues = data.map(d => d.count);
    const trueMaxY = Math.max(...rawValues, 1);
    const lineCount = data.length;

    /* ----------------------------
       BINNING (AVERAGE FOR SHAPE)
    ----------------------------- */

    let values = rawValues.slice();
    let n = values.length;

    if (n > maxPoints) {
        const binSize = Math.ceil(n / maxPoints);
        const binned = [];

        for (let i = 0; i < n; i += binSize) {
            const slice = values.slice(i, i + binSize);
            const maxVal = Math.max(...slice);
            binned.push(maxVal);
        }

        values = binned;
        n = values.length;
    }

    const innerW = width - margin.left - margin.right;
    const innerH = height - margin.top - margin.bottom;

    const scaleX = i => margin.left + (i / (n - 1)) * innerW;
    const scaleY = v => margin.top + innerH - (v / trueMaxY) * innerH;

    /* ----------------------------
       POLYLINE
    ----------------------------- */

    const points = values
        .map((v, i) => `${scaleX(i)},${scaleY(v)}`)
        .join(" ");

    /* ----------------------------
       AXES
    ----------------------------- */

    const x0 = scaleX(0);
    const x1 = scaleX(n - 1);
    const y0 = margin.top + innerH;
    const y1 = margin.top;

    /* Y-axis integer ticks */
    const yTicks = Math.min(trueMaxY, 5);
    const yStep = Math.ceil(trueMaxY / yTicks);

    /* X-axis ticks (~5) */
    const xTicks = 5;
    const xLabels = [];
    for (let i = 0; i < xTicks; i++) {
        const frac = i / (xTicks - 1);
        const lineNum = Math.round(1 + frac * (lineCount - 1));
        const x = margin.left + frac * innerW;
        xLabels.push({ x, lineNum });
    }

    return `
        <h4>Hiatus Density per Line</h4>
        <svg width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">

            <!-- Axes -->
            <line x1="${x0}" y1="${y0}" x2="${x1}" y2="${y0}" stroke="#000"/>
            <line x1="${x0}" y1="${y0}" x2="${x0}" y2="${y1}" stroke="#000"/>

            <!-- Y-axis labels -->
            ${Array.from({ length: yTicks + 1 }, (_, i) => {
                const v = i * yStep;
                if (v > trueMaxY) return "";
                return `
                    <text x="${x0 - 6}" y="${scaleY(v)}"
                          text-anchor="end" dominant-baseline="middle"
                          font-size="10">${v}</text>
                `;
            }).join("")}

            <!-- X-axis labels -->
            ${xLabels.map(l => `
                <text x="${l.x}" y="${y0 + 16}"
                      text-anchor="middle" font-size="10">
                    ${l.lineNum}
                </text>
            `).join("")}

            <!-- Sparkline -->
            <polyline
                fill="none"
                stroke="#444"
                stroke-width="2"
                points="${points}"
            />
        </svg>
    `;
}

function renderPerLineTable() {
    if (!lastPerLineData) return "";

    const data = [...lastPerLineData];
    const max = Math.max(...data.map(d => d.count));

    data.sort((a, b) => {
        const key = perLineSort.col;
        const dir = perLineSort.asc ? 1 : -1;
        return (a[key] - b[key]) * dir;
    });

    let rows = data.map(d => `
        <tr style="background:${heatColor(d.count, max)}">
            <td>${d.line}</td>
            <td>${d.count}</td>
        </tr>
    `).join("");

    const arrow = c =>
        perLineSort.col === c ? (perLineSort.asc ? " ▲" : " ▼") : "";

   const sparkline = renderSparklineFromData(lastPerLineData);

    return `
        <h3>Hiatus per Line</h3>
        <table border="1" cellpadding="6">
            <tr>
                <th style="cursor:pointer" onclick="sortPerLine('line')">
                    Line${arrow("line")}
                </th>
                <th style="cursor:pointer" onclick="sortPerLine('count')">
                    #${arrow("count")}
                </th>
            </tr>
            ${rows}
        </table>
        ${sparkline}
    `;

}

function sortPerLine(col) {
    if (perLineSort.col === col) {
        perLineSort.asc = !perLineSort.asc;
    } else {
        perLineSort.col = col;
        perLineSort.asc = true;
    }
    document.getElementById("perLineContainer").innerHTML =
        renderPerLineTable();
}



/* ----------------------------
   CORE DETECTOR RUN
----------------------------- */

async function runDetector(text) {
    const pyodide = await pyodideReadyPromise;

    await pyodide.FS.writeFile(
        "detector.py",
        await (await fetch("detector.py")).text()
    );
    await pyodide.runPythonAsync(`import detector`);

    const options = {
        break_on_dash: document.getElementById("breakOnDash").checked,
        break_on_punctuation: document.getElementById("breakOnPunctuation").checked,
        break_on_rough_second: document.getElementById("breakOnRoughSecond").checked,
        detect_intra: document.getElementById("detectIntra").checked,
        detect_inter: document.getElementById("detectInter").checked,
        detect_across: document.getElementById("detectAcross").checked
    };

    pyodide.FS.writeFile("/options.json", JSON.stringify(options));
    pyodide.FS.writeFile("/app_input.txt", text);

    await pyodide.runPythonAsync(`
from pathlib import Path
from detector import detect_hiatus_in_text, write_outputs
text = Path("/app_input.txt").read_text(encoding="utf-8")
annotated, occ = detect_hiatus_in_text(text)
write_outputs(annotated, occ, Path("/out.html"), Path("/out.csv"))
    `);

    return {
        html: pyodide.FS.readFile("/out.html", { encoding: "utf8" }),
        csv:  pyodide.FS.readFile("/out.csv",  { encoding: "utf8" })
    };
}

/* ----------------------------
   FILE DOWNLOADS
----------------------------- */

function downloadFile(filename, content, mime) {
    const blob = new Blob([content], { type: mime });
    const url = URL.createObjectURL(blob);

    const a = document.createElement("a");
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);

    URL.revokeObjectURL(url);
}


/* ----------------------------
   RUN BUTTON HANDLER
----------------------------- */

document.getElementById("runBtn").onclick = async () => {
    const input = document.getElementById("fileInput").files[0];
    if (!input) return alert("Please select a .txt file first.");

    const status = document.getElementById("status");
    const output = document.getElementById("output");

    status.textContent = "Running detector…";
    output.innerHTML = "";

    try {
        const text = await input.text();
        const lineCount = text.split(/\r?\n/).filter(l => l.trim()).length;
        const result = await runDetector(text);

        lastHtmlOutput = result.html;
        lastCsvOutput  = result.csv;

        const counts = countHiatusFromCsv(result.csv);
        const hiatusPerLine = lineCount
            ? (counts.total / lineCount).toFixed(3)
            : "0.000";

        let perLineSection = "";
        lastPerLineCsv = null;
        lastPerLineData = null;

        if (document.getElementById("showPerLineTable").checked) {
            const perLine = countHiatusPerLine(result.csv, lineCount);
            const csvRows = ["line,hiatus_count"];

            lastPerLineData = [];

            for (let i = 1; i <= lineCount; i++) {
                lastPerLineData.push({ line: i, count: perLine[i] });
                csvRows.push(`${i},${perLine[i]}`);
            }

            lastPerLineCsv = csvRows.join("\n");

            perLineSection = `<div id="perLineContainer">
                ${renderPerLineTable()}
            </div>`;
        }

        document.getElementById("downloadPerLineCsvBtn").disabled =
            !lastPerLineCsv;

        status.textContent = "Done!";
        output.innerHTML = `
            <h3>Hiatus Counts</h3>
            <ul>
                <li>I: ${counts.I}</li>
                <li>B: ${counts.B}</li>
                <li>V: ${counts.V}</li>
                <li><strong>Total: ${counts.total}</strong></li>
                <li># of hiatus instances per line: ${hiatusPerLine}</li>
            </ul>
            ${perLineSection}
            <h3>Annotated HTML</h3>
            <div>${result.html}</div>
            <h3>CSV Output</h3>
            <pre>${result.csv}</pre>
        `;

        document.getElementById("downloadHtmlBtn").disabled = false;
        document.getElementById("downloadCsvBtn").disabled = false;

    } catch (err) {
        status.textContent = "Error running detector.";
        console.error(err);
    }
};

/* ----------------------------
   DOWNLOAD BUTTONS
----------------------------- */

document.getElementById("downloadHtmlBtn").onclick = () => {
    if (lastHtmlOutput)
        downloadFile("hiatus_output.html", lastHtmlOutput, "text/html");
};

document.getElementById("downloadCsvBtn").onclick = () => {
    if (lastCsvOutput)
        downloadFile("hiatus_output.csv", lastCsvOutput, "text/csv");
};

document.getElementById("downloadPerLineCsvBtn").onclick = () => {
    if (lastPerLineCsv)
        downloadFile("hiatus_per_line.csv", lastPerLineCsv, "text/csv");
};
