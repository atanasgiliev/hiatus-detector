let pyodideReady = false;
let pyodideInstance = null;

async function initPyodide() {
    document.getElementById("output").textContent = "Loading Python (Pyodide)...";
    pyodideInstance = await loadPyodide();
    pyodideReady = true;
    document.getElementById("output").textContent = "Python ready.";
    document.getElementById("runBtn").disabled = false;
}

initPyodide();

document.getElementById("runBtn").addEventListener("click", async () => {
    if (!pyodideReady) return;

    const fileInput = document.getElementById("fileInput");
    if (!fileInput.files.length) {
        alert("Please select a text file first.");
        return;
    }

    const file = fileInput.files[0];
    const text = await file.text();

    document.getElementById("output").textContent = "Running hiatus detector...\n";

    // --- load your detector.py into the python environment ---
    const detectorCode = await fetch("detector.py").then(r => r.text());
    pyodideInstance.runPython(detectorCode);

    // --- write input text into Pyodide virtual FS ---
    pyodideInstance.FS.writeFile("input.txt", text, { encoding: "utf8" });

    // --- run your Python main() on the virtual input.txt ---
    const result = pyodideInstance.runPython(`
from pathlib import Path
from detector import detect_hiatus_in_text, write_outputs

text = Path("input.txt").read_text(encoding="utf-8")
annotated, occ = detect_hiatus_in_text(text)
write_outputs(annotated, occ, Path("hiatus.html"), Path("hiatus.csv"))
len(occ)
`);

    document.getElementById("output").textContent += `Done. Detected ${result} hiatuses.\nPreparing downloads...`;

    // --- read output files and trigger browser download ---
    function downloadFile(name, mime) {
        const data = pyodideInstance.FS.readFile(name, { encoding: "utf8" });
        const blob = new Blob([data], { type: mime });
        const url = URL.createObjectURL(blob);
        const a = document.createElement("a");
        a.href = url;
        a.download = name;
        a.click();
    }

    downloadFile("hiatus.html", "text/html");
    downloadFile("hiatus.csv", "text/csv");

    document.getElementById("output").textContent += "\nFiles downloaded.";
});
