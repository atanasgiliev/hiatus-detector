import csv
import html
import unicodedata
from pathlib import Path
from collections import defaultdict

# ----- configuration -----
DIPHTHONGS = {"αι","αυ","ει","ευ","οι","ου","υι","ωι","ῃ","ῳ"}
PRECOMPOSED_DIAERESIS = {"ϊ","ΐ","ϋ","ΰ","Ϊ","Ϋ"}
COMBINING_DIAERESIS = "\u0308"
IOTA_SUBSCRIPT = "\u0345"

SMOOTH_BREATHING = "\u0313"
ROUGH_BREATHING  = "\u0314"
BREATHINGS = {SMOOTH_BREATHING, ROUGH_BREATHING}

# breakers
DASHES = {"—"}
STRONG_PUNCTUATION = {".", ",", "·", ";", ":"}

PRECOMPOSED_IOTA_SUBS = {
    'ᾳ','ᾴ','ᾲ','ᾷ','ᾀ','ᾁ','ᾂ','ᾃ','ᾄ','ᾅ','ᾆ','ᾇ',
    'ῃ','ῄ','ῂ','ῇ','ᾐ','ᾑ','ᾒ','ᾓ','ᾔ','ᾕ','ᾖ','ᾗ',
    'ῳ','ῴ','ῲ','ῷ','ᾠ','ᾡ','ᾢ','ᾣ','ᾤ','ᾥ','ᾦ','ᾧ'
}

BASE_VOWELS = "αεηιουω"

# ---------------------------
# Grapheme cluster helpers
# ---------------------------
def grapheme_clusters(s):
    clusters = []
    i = 0
    while i < len(s):
        start = i
        i += 1
        while i < len(s) and unicodedata.combining(s[i]):
            i += 1
        clusters.append({"text": s[start:i], "start": start, "end": i})
    return clusters

def base_letter(cluster_text):
    for ch in unicodedata.normalize("NFD", cluster_text):
        if not unicodedata.combining(ch):
            return ch.lower()
    return ""

def contains_combining_diaeresis(cluster_text):
    return (
        any(ch in PRECOMPOSED_DIAERESIS for ch in cluster_text)
        or COMBINING_DIAERESIS in unicodedata.normalize("NFD", cluster_text)
    )

def contains_iota_subscript(cluster_text):
    nfd = unicodedata.normalize("NFD", cluster_text)
    if IOTA_SUBSCRIPT in nfd:
        return True
    for ch in cluster_text:
        if "0345" in unicodedata.decomposition(ch):
            return True
    return cluster_text in PRECOMPOSED_IOTA_SUBS

def has_rough_breathing(cluster_text):
    return ROUGH_BREATHING in unicodedata.normalize("NFD", cluster_text)

def is_vowel_cluster(cluster_text):
    return any(
        ch.lower() in BASE_VOWELS
        for ch in unicodedata.normalize("NFD", cluster_text)
        if not unicodedata.combining(ch)
    )

def is_punct_or_space_cluster(cluster_text):
    for ch in cluster_text:
        if ch.isspace():
            continue
        if unicodedata.category(ch).startswith(("P","S")):
            continue
        return False
    return True

def only_punct_space_between(text, a, b):
    for ch in text[a:b]:
        if unicodedata.category(ch).startswith(("L","N")):
            return False
    return True

# ---------------------------
# Core detection
# ---------------------------
def detect_hiatus_in_text(
    text,
    treat_iota_as_diphthong=False,
    max_cluster_lookahead=8,
    break_on_rough_breathing=False,
    break_on_dash=False,
    break_on_punctuation=False
):
    text = unicodedata.normalize("NFC", text)
    clusters = grapheme_clusters(text)

    for c in clusters:
        c["line"] = text.count("\n", 0, c["start"])

    line_map = defaultdict(list)
    for i, c in enumerate(clusters):
        line_map[c["line"]].append(i)

    first_np = {}
    last_np = {}
    for ln, idxs in line_map.items():
        first = last = None
        for i in idxs:
            if not is_punct_or_space_cluster(clusters[i]["text"]):
                if first is None:
                    first = i
                last = i
        first_np[ln] = first
        last_np[ln] = last

    occurrences = []

    for i, ci in enumerate(clusters):
        if not is_vowel_cluster(ci["text"]):
            continue

        for j in range(i+1, min(i+1+max_cluster_lookahead, len(clusters))):
            cj = clusters[j]
            if not is_vowel_cluster(cj["text"]):
                continue

            intervening = text[ci["end"]:cj["start"]]
            kind = None

            if "\n" in intervening:
                if cj["line"] == ci["line"] + 1:
                    if last_np[ci["line"]] == i and first_np[cj["line"]] == j:
                        kind = "across-line"
            elif intervening == "":
                kind = "intra-word"
            elif only_punct_space_between(text, ci["end"], cj["start"]) and ci["line"] == cj["line"]:
                kind = "interword"

            if not kind:
                continue

            if break_on_rough_breathing and has_rough_breathing(cj["text"]):
                continue
            if break_on_dash and any(d in intervening for d in DASHES):
                continue
            if break_on_punctuation and any(p in intervening for p in STRONG_PUNCTUATION):
                continue

            is_diph = False
            if kind == "intra-word":
                pair = base_letter(ci["text"]) + base_letter(cj["text"])
                if pair in DIPHTHONGS:
                    is_diph = True
                if treat_iota_as_diphthong and (
                    contains_iota_subscript(ci["text"]) or contains_iota_subscript(cj["text"])
                ):
                    is_diph = True
                if contains_combining_diaeresis(cj["text"]):
                    is_diph = False
                if has_rough_breathing(ci["text"]):
                    is_diph = False

            if is_diph:
                break

            occurrences.append({
                "kind": kind,
                "start_pos": ci["start"],
                "end_pos": cj["end"],
                "i_index": i,
                "j_index": j,
                "line_i": ci["line"] + 1,
                "line_j": cj["line"] + 1,
                "intervening": intervening
            })
            break

    cluster_marks = defaultdict(list)
    for n, occ in enumerate(occurrences, 1):
        cluster_marks[occ["i_index"]].append(n)
        cluster_marks[occ["j_index"]].append(n)

    html_out = []
    for i, c in enumerate(clusters):
        esc = html.escape(c["text"])
        if i in cluster_marks:
            kind = occurrences[cluster_marks[i][0]-1]["kind"]
            cls = {
                "intra-word": "hiatus-intra",
                "interword": "hiatus-inter",
                "across-line": "hiatus-across"
            }[kind]
            html_out.append(f'<span class="{cls}">{esc}</span>')
        else:
            html_out.append(esc)

    return "".join(html_out), occurrences

# ---------------------------
# Output writer
# ---------------------------
def write_outputs(annotated, occurrences, html_path, csv_path):
    html_path.write_text(annotated, encoding="utf-8")
    with csv_path.open("w", newline="", encoding="utf-8") as f:
        writer = csv.writer(f)
        writer.writerow(["index","kind","line_i","line_j"])
        for i, o in enumerate(occurrences, 1):
            writer.writerow([i, o["kind"], o["line_i"], o["line_j"]])

# ---------------------------
# process() — web API
# ---------------------------
def process(input_path, html_path, csv_path, **kwargs):
    text = Path(input_path).read_text(encoding="utf-8")
    annotated, occ = detect_hiatus_in_text(text, **kwargs)
    write_outputs(annotated, occ, Path(html_path), Path(csv_path))
    return occ
