let pyodideReadyPromise = loadPyodide();

async function runDetector(text, options) {
    const pyodide = await pyodideReadyPromise;

    // load detector.py
    await pyodide.FS.writeFile(
        "detector.py",
        await (await fetch("detector.py")).text()
    );
    await pyodide.runPythonAsync(`import detector`);

    // write input text
    pyodide.FS.writeFile("/app_input.txt", text, { encoding: "utf8" });

    // IMPORTANT: pass options as Python variables
    await pyodide.runPythonAsync(`
from pathlib import Path
from detector import detect_hiatus_in_text, write_outputs

break_on_rough_second = ${options.breakRough}
break_on_dash = ${options.breakDash}
break_on_punctuation = ${options.breakPunct}

text = Path("/app_input.txt").read_text(encoding="utf-8")

annotated, occ = detect_hiatus_in_text(
    text,
    break_on_rough_second=break_on_rough_second,
    break_on_dash=break_on_dash,
    break_on_punctuation=break_on_punctuation
)

write_outputs(
    annotated,
    occ,
    Path("/out.html"),
    Path("/out.csv")
)
    `);

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

    status.textContent = "Running hiatus detector…";
    output.innerHTML = "";

    const options = {
        breakRough: document.getElementById("breakRough").checked,
        breakDash: document.getElementById("breakDash").checked,
        breakPunct: document.getElementById("breakPunct").checked
    };

    try {
        const text = await input.text();
        const result = await runDetector(text, options);

        status.textContent = "Done!";

        output.innerHTML = `
            <h3>Annotated HTML Output</h3>
            <div>${result.html}</div>

            <h3>CSV Output</h3>
            <pre>${result.csv}</pre>
        `;
    } } catch (err) {
    status.textContent = "Error running detector.";
    alert(err);
    console.error(err);
    }
};
