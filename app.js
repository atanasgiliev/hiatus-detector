let pyodideReadyPromise = loadPyodide();

async function runDetector(text) {
    const pyodide = await pyodideReadyPromise;

    // load detector.py
    await pyodide.FS.writeFile("detector.py", await (await fetch("detector.py")).text());
    await pyodide.runPythonAsync(`import detector`);

    // write input text
    pyodide.FS.writeFile("/app_input.txt", text, { encoding: "utf8" });

    const breakOnRoughSecond = document.getElementById("optRoughSecond").checked;
    const breakOnDash = document.getElementById("optDash").checked;
    const breakOnPunct = document.getElementById("optPunct").checked;

    // run detection (no CLI)
    await pyodide.runPythonAsync(`
from detector import process

process(
    "/app_input.txt",
    "/out.html",
    "/out.csv",
    break_on_rough_second=${breakOnRoughSecond},
    break_on_dash=${breakOnDash},
    break_on_punctuation=${breakOnPunct}
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
