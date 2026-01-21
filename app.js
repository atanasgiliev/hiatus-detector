let pyodideReadyPromise = loadPyodide();

// store outputs for download buttons
let lastHtmlOutput = null;
let lastCsvOutput = null;

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
        document.getElementById(id).addEventListener(
            "change",
            updateRunButtonState
        );
    });
});

/* ----------------------------
   CSV → HIATUS COUNTS
----------------------------- */

function countHiatusFromCsv(csvText) {
    const lines = csvText.trim().split("\n");
    lines.shift(); // remove header

    const counts = {
        I: 0,
        B: 0,
        V: 0,
        total: 0
    };

    for (const line of lines) {
        if (!line.trim()) continue;
        const cols = line.split(",");
        const kind = cols[1];

        if (kind === "I" || kind === "B" || kind === "V") {
            counts[kind]++;
            counts.total++;
        }
    }

    return counts;
}

/* ----------------------------
   CORE DETECTOR RUN
----------------------------- */

async function runDetector(text) {
    const pyodide = await pyodideReadyPromise;

    // load detector.py
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

    // write options file
    pyodide.FS.writeFile(
        "/options.json",
        JSON.stringify(options),
        { encoding: "utf8" }
    );

    // write input text
    pyodide.FS.writeFile("/app_input.txt", text, { encoding: "utf8" });

    // run detection
    await pyodide.runPythonAsync(`
from pathlib import Path
from detector import detect_hiatus_in_text, write_outputs

text = Path("/app_input.txt").read_text(encoding="utf-8")
annotated, occ = detect_hiatus_in_text(text)

write_outputs(
    annotated,
    occ,
    Path("/out.html"),
    Path("/out.csv")
)
    `);

    // read outputs
    const html = pyodide.FS.readFile("/out.html", { encoding: "utf8" });
    const csv  = pyodide.FS.readFile("/out.csv",  { encoding: "utf8" });

    return { html, csv };
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
    if (!input) {
        alert("Please select a .txt file first.");
        return;
    }

    const status = document.getElementById("status");
    const output = document.getElementById("output");

    status.textContent = "Loading Pyodide & running detector...";
    output.innerHTML = "";

    try {
        const text = await input.text();
        const result = await runDetector(text);

        // store for downloads
        lastHtmlOutput = result.html;
        lastCsvOutput  = result.csv;

        const counts = countHiatusFromCsv(result.csv);

        status.textContent = "Done!";

        output.innerHTML = `
            <h3>Hiatus Counts</h3>
            <ul>
                <li>Intra-word (I): ${counts.I}</li>
                <li>Inter-word (B): ${counts.B}</li>
                <li>Across-line (V): ${counts.V}</li>
                <li><strong>Total: ${counts.total}</strong></li>
            </ul>

            <h3>Annotated HTML Output</h3>
            <div>${result.html}</div>

            <h3>CSV Output</h3>
            <pre>${result.csv}</pre>
        `;

        // enable download buttons
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
    if (lastHtmlOutput !== null) {
        downloadFile("hiatus_output.html", lastHtmlOutput, "text/html");
    }
};

document.getElementById("downloadCsvBtn").onclick = () => {
    if (lastCsvOutput !== null) {
        downloadFile("hiatus_output.csv", lastCsvOutput, "text/csv");
    }
};
