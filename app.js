let pyodideReadyPromise = loadPyodide();

async function runDetector(text) {
    const pyodide = await pyodideReadyPromise;

    // Load detector.py into Pyodide FS
    await pyodide.FS.writeFile(
        "detector.py",
        await (await fetch("detector.py")).text()
    );

    // Import detector module
    await pyodide.runPythonAsync(`import detector`);

    // Write input text file
    pyodide.FS.writeFile("/app_input.txt", text, { encoding: "utf8" });

    // Call the Python wrapper function
    await pyodide.runPythonAsync(`
from detector import process
process(
    "/app_input.txt",
    "/out.html",
    "/out.csv"
)
    `);

    // Read outputs
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

    status.textContent = "Loading Pyodide & running detector…";
    output.innerHTML = "";

    try {
        const text = await input.text();
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
