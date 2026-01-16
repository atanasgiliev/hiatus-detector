let pyodideReadyPromise = loadPyodide();

async function runDetector(text) {
    const pyodide = await pyodideReadyPromise;

    // load detector.py
    await pyodide.FS.writeFile("detector.py", await (await fetch("detector.py")).text());
    await pyodide.runPythonAsync(`import detector`);

    // write input text
    pyodide.FS.writeFile("/app_input.txt", text, { encoding: "utf8" });

    // run detection (no CLI)
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

    const text = await input.text();

    try {
        const result = await runDetector(text);
        status.textContent = "Done!";

        output.innerHTML = `
            <h3>Annotated HTML Output</h3>
            <div>${result.html}</div>

            <h3>CSV Output</h3>
            <pre>${result.csv}</pre>
        `;
    } catch (err) {
        status.textContent = "Error running detector.";
        console.error(err);
    }
};
