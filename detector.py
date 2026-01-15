import argparse
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

# NEW — breakers
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
    N = len(s)
    while i < N:
        start = i
        i += 1
        while i < N and unicodedata.combining(s[i]) != 0:
            i += 1
        clusters.append({"text": s[start:i], "start": start, "end": i})
    return clusters

def base_letter(cluster_text):
    nfd = unicodedata.normalize("NFD", cluster_text)
    for ch in nfd:
        if unicodedata.combining(ch) == 0:
            return ch.lower()
    return ""

def contains_combining_diaeresis(cluster_text):
    if any(ch in PRECOMPOSED_DIAERESIS for ch in cluster_text):
        return True
    return COMBINING_DIAERESIS in unicodedata.normalize("NFD", cluster_text)

def contains_iota_subscript(cluster_text):
    if IOTA_SUBSCRIPT in unicodedata.normalize("NFD", cluster_text):
        return True
    if IOTA_SUBSCRIPT in unicodedata.normalize("NFKD", cluster_text):
        return True
    for ch in cluster_text:
        decomp = unicodedata.decomposition(ch)
        if decomp and "0345" in decomp:
            return True
    return cluster_text in PRECOMPOSED_IOTA_SUBS

def has_rough_breathing(cluster_text):  # NEW
    return ROUGH_BREATHING in unicodedata.normalize("NFD", cluster_text)

def is_vowel_cluster(cluster_text):
    nfd = unicodedata.normalize("NFD", cluster_text)
    bases = [c for c in nfd if unicodedata.combining(c) == 0]
    return any(b.lower() in BASE_VOWELS for b in bases)

def is_punct_or_space_cluster(cluster_text):
    for ch in cluster_text:
        if ch.isspace():
            continue
        cat = unicodedata.category(ch)
        if cat.startswith(("P","S")):
            continue
        return False
    return True

def only_punct_space_between(text, a, b):
    for ch in text[a:b]:
        cat = unicodedata.category(ch)
        if cat.startswith(("L","N")):
            return False
    return True

# ---------------------------
# Core detection
# ---------------------------
def detect_hiatus_in_text(
    text,
    treat_iota_as_diphthong=False,
    max_cluster_lookahead=8,
    break_on_rough_breathing=False,   # NEW
    break_on_dash=False,              # NEW
    break_on_punctuation=False        # NEW
):
    text = unicodedata.normalize("NFC", text)
    clusters = grapheme_clusters(text)

    def line_number_at(idx):
        return text.count("\n", 0, idx)

    for c in clusters:
        c['line'] = line_number_at(c['start'])

    line_to_idxs = defaultdict(list)
    for idx, c in enumerate(clusters):
        line_to_idxs[c['line']].append(idx)

    first_nonpunct = {}
    last_nonpunct = {}
    for ln, idxs in line_to_idxs.items():
        first = last = None
        for idx in idxs:
            if is_punct_or_space_cluster(clusters[idx]['text']):
                continue
            if first is None:
                first = idx
            last = idx
        first_nonpunct[ln] = first
        last_nonpunct[ln] = last

    occurrences = []

    for i, ci in enumerate(clusters):
        if not is_vowel_cluster(ci['text']):
            continue

        for j in range(i+1, min(i+1+max_cluster_lookahead, len(clusters))):
            cj = clusters[j]
            if not is_vowel_cluster(cj['text']):
                continue

            intervening = text[ci['end']:cj['start']]
            kind = None

            if "\n" in intervening:
                if cj['line'] == ci['line'] + 1:
                    if last_nonpunct.get(ci['line']) == i and first_nonpunct.get(cj['line']) == j:
                        kind = "across-line"
            elif intervening == "":
                kind = "intra-word"
            elif only_punct_space_between(text, ci['end'], cj['start']) and ci['line'] == cj['line']:
                kind = "interword"

            if kind is None:
                continue

            # --------- NEW BREAKER RULES ----------
            if break_on_rough_breathing and has_rough_breathing(cj['text']):
                continue

            if break_on_dash and any(d in intervening for d in DASHES):
                continue

            if break_on_punctuation and any(p in intervening for p in STRONG_PUNCTUATION):
                continue
            # -------------------------------------

            is_diph = False
            if kind == "intra-word":
                pair = base_letter(ci['text']) + base_letter(cj['text'])
                if pair in DIPHTHONGS:
                    is_diph = True
                if treat_iota_as_diphthong and (
                    contains_iota_subscript(ci['text']) or contains_iota_subscript(cj['text'])
                ):
                    is_diph = True
                if contains_combining_diaeresis(cj['text']):
                    is_diph = False
                if has_rough_breathing(ci['text']):
                    is_diph = False

            if is_diph:
                break

            occurrences.append({
                "kind": kind,
                "start_pos": ci['start'],
                "end_pos": cj['end'],
                "cluster_i_text": ci['text'],
                "cluster_j_text": cj['text'],
                "line_i": ci['line'] + 1,
                "line_j": cj['line'] + 1,
                "i_index": i,
                "j_index": j,
                "intervening": intervening
            })
            break

    # --------- expand vowel segments (unchanged) ----------
    def safe_base(idx):
        return base_letter(clusters[idx]['text']) if 0 <= idx < len(clusters) else ""

    for occ in occurrences:
        i = occ['i_index']
        j = occ['j_index']
        vi = [i]
        vj = [j]

        if i + 1 < j and safe_base(i) + safe_base(i + 1) in DIPHTHONGS:
            vi = [i, i + 1]
        elif i - 1 >= 0 and safe_base(i - 1) + safe_base(i) in DIPHTHONGS:
            vi = [i - 1, i]

        if j - 1 > i and safe_base(j - 1) + safe_base(j) in DIPHTHONGS:
            vj = [j - 1, j]
        elif j + 1 < len(clusters) and safe_base(j) + safe_base(j + 1) in DIPHTHONGS:
            vj = [j, j + 1]

        occ['vowel_i_indices'] = vi
        occ['vowel_j_indices'] = vj
        occ['vowel_i_text'] = "".join(clusters[k]['text'] for k in vi)
        occ['vowel_j_text'] = "".join(clusters[k]['text'] for k in vj)

    # annotate HTML
    cluster_marks = defaultdict(list)
    for n, occ in enumerate(occurrences, 1):
        for k in occ['vowel_i_indices'] + occ['vowel_j_indices']:
            cluster_marks[k].append(n)

    html_parts = []
    for k, cl in enumerate(clusters):
        esc = html.escape(cl['text'])
        if k in cluster_marks:
            occ = occurrences[min(cluster_marks[k]) - 1]
            cls = {
                "intra-word": "hiatus-intra",
                "interword": "hiatus-inter",
                "across-line": "hiatus-across"
            }[occ['kind']]
            html_parts.append(f'<span class="{cls}">{esc}</span>')
        else:
            html_parts.append(esc)

    return "".join(html_parts), occurrences

# ---------------------------
# process() — unchanged API
# ---------------------------
def process(input_path, html_path, csv_path, **kwargs):
    text = Path(input_path).read_text(encoding="utf-8")
    annotated, occ = detect_hiatus_in_text(text, **kwargs)
    write_outputs(annotated, occ, Path(html_path), Path(csv_path))
    return occ

if __name__ == "__main__":
    main()
    
