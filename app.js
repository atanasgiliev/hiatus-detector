let pyodideReadyPromise = loadPyodide();

// store outputs for download buttons
let lastHtmlOutput = null;
let lastCsvOutput = null;
let lastPerLineCounts = null;
let lastLineCount = 0;

// sorting state
let currentSort = { column: "line", asc: true };

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
        const lineField = row.split(",")[2];
        if (!lineField) continue;

        if (lineField.includes("-")) {
            const [a, b] = lineField.split("-").map(Number);
            if (perLine[a] !== undefined) perLine[a]++;
            if (perLine[b] !== undefined) perLine[b]++;
        } else {
            const n = parseInt(lineField, 10);
            if (perLine[n] !== undefined) perLine[n]++;
        }
    }
    return perLine;
}

/* ----------------------------
   TABLE + SPARKLINE RENDERING
----------------------------- */

function renderPerLineTable() {
    const entries = Object.entries(lastPerLineCounts).map(
        ([line, count]) => ({ line: Number(line), count })
    );

    entries.sort((a, b) => {
        const key = currentSort.column;
        const dir = currentSort.asc ? 1 : -1;
        return (a[key] - b[key]) * dir;
    });

    const max = Math.max(...entries.map(e => e.count), 1);

    const rows = entries.map(e => `
        <tr>
            <td>${e.line}</td>
            <td>${e.count}</td>
        </tr>
    `).join("");

    const sparkBars = entries.map(e => {
        const h = Math.round((e.count / max) * 40);
        return `<div class="spark-bar" style="height:${h}px"></div>`;
    }).join("");

    return `
        <h3>Hiatus per Line</h3>

        <table border="1" cellpadding="6" cellspacing="0">
            <thead>
                <tr>
                    <th style="cursor:pointer" onclick="sortTable('line')">
                        Line ${currentSort.column === "line" ? (currentSort.asc ? "▲" : "▼") : ""}
                    </th>
                    <th style="cursor:pointer" onclick="sortTable('count')">
                        # of Hiatus ${currentSort.column === "count" ? (currentSort.asc ? "▲" : "▼") : ""}
                    </th>
                </tr>
            </thead>
            <tbody>${rows}</tbody>
        </table>

        <div class="sparkline">
            ${sparkBars}
        </div>
    `;
}

function sortTable(column) {
    if (currentSort.column === column) {
        currentSort.asc = !currentSort.asc;
    } else {
        currentSort.column = column;
        currentSort.asc = true;
    }
    document.getElementById("perLineContainer").innerHTML = renderPerLineTable();
}

/* ----------------------------
   CORE DETECTOR
----------------------------- */

async function runDetector(text) {
    const pyodide = await pyodideReadyPromise;

    await pyodide.FS.writeFile("detector.py", await (await fetch("detector.py")).text());
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

text = Path("/app_input.txt").read_text()
annotated, occ = detect_hiatus_in_text(text)
write_outputs(annotated, occ, Path("/out.html"), Path("/out.csv"))
    `);

    return {
        html: pyodide.FS.readFile("/out.html", { encoding: "utf8" }),
        csv:  pyodide.FS.readFile("/out.csv",  { encoding: "utf8" })
    };
}

/* ----------------------------
   RUN HANDLER
----------------------------- */

document.getElementById("runBtn").onclick = async () => {
    const input = document.getElementById("fileInput").files[0];
    if (!input) return alert("Please select a .txt file.");

    const status = document.getElementById("status");
    const output = document.getElementById("output");

    status.textContent = "Running detector…";
    output.innerHTML = "";

    try {
        const text = await input.text();
        lastLineCount = text.split(/\r?\n/).filter(l => l.trim()).length;

        const result = await runDetector(text);
        lastHtmlOutput = result.html;
        lastCsvOutput = result.csv;

        const counts = countHiatusFromCsv(result.csv);
        lastPerLineCounts = countHiatusPerLine(result.csv, lastLineCount);

        output.innerHTML = `
            <h3>Hiatus Counts</h3>
            <ul>
                <li>I: ${counts.I}</li>
                <li>B: ${counts.B}</li>
                <li>V: ${counts.V}</li>
                <li><strong>Total: ${counts.total}</strong></li>
            </ul>

            <div id="perLineContainer">
                ${renderPerLineTable()}
            </div>

            <h3>Annotated Output</h3>
            <div>${result.html}</div>
        `;

        status.textContent = "Done!";
        document.getElementById("downloadHtmlBtn").disabled = false;
        document.getElementById("downloadCsvBtn").disabled = false;

    } catch (err) {
        status.textContent = "Error.";
        console.error(err);
    }
};
