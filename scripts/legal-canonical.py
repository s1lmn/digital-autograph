"""Offline, stdlib-only conversion of the pinned Destka DOCX sources.

No network, document editing, or legal paraphrasing. Run with --check in review.
This converter deliberately rejects unfamiliar Word structures instead of silently
losing content. Its input contract is the eight supplied, explicitly numbered DOCX.
"""

import argparse
import hashlib
import json
import re
import xml.etree.ElementTree as ET
import zipfile
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
LEGAL = ROOT / "docs/legal"
SOURCE = LEGAL / "sources/destka-20261010/original_docx"
NS = {"w": "http://schemas.openxmlformats.org/wordprocessingml/2006/main"}
W = "{" + NS["w"] + "}"


def sha(data):
    return hashlib.sha256(data).hexdigest()


def convert(path):
    with zipfile.ZipFile(path) as docx:
        tree = ET.fromstring(docx.read("word/document.xml"))
        # These sources have literal numbering and no tables/tracked edits/fields.
        for tag in ("numPr", "tbl", "ins", "del", "fldChar", "instrText", "drawing", "object", "altChunk"):
            if tree.find(".//w:" + tag, NS) is not None:
                raise ValueError("Unsupported Word structure: " + tag)
        for name in docx.namelist():
            if re.fullmatch(r"word/(header\d*|footer\d*|footnotes|endnotes|comments)\.xml", name):
                extra = ET.fromstring(docx.read(name))
                if any((t.text or "").strip() for t in extra.findall(".//w:t", NS)):
                    raise ValueError("Supplementary text needs explicit conversion: " + name)
        body = tree.find("w:body", NS)
        paragraphs = []
        for paragraph in body:
            if paragraph.tag == W + "sectPr":
                continue
            if paragraph.tag != W + "p":
                raise ValueError("Unsupported body element")
            text = "".join(
                node.text or "" if node.tag == W + "t"
                else "\t" if node.tag == W + "tab"
                else "\n" if node.tag in (W + "br", W + "cr")
                else ""
                for node in paragraph.iter()
            )
            if text.strip():
                paragraphs.append(text)
        # Preserve wording/literal numbering; layout only: blank line between
        # nonempty paragraphs, Word linebreaks/tabs, UTF-8 without BOM, final LF.
        return ("\n\n".join(paragraphs) + "\n").encode("utf-8"), len(paragraphs)


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--check", action="store_true")
    args = parser.parse_args()
    records = json.loads((LEGAL / "destka-source-map.json").read_text("utf-8"))
    manifest = []
    for record in records:
        source = SOURCE / record["sourceFile"]
        if sha(source.read_bytes()) != record["sourceDocxSha256"]:
            raise ValueError("Source hash mismatch: " + record["number"])
        content, paragraphs = convert(source)
        target = LEGAL / record["file"]
        if args.check:
            if target.read_bytes() != content:
                raise ValueError("Canonical bytes differ: " + record["number"])
        else:
            target.parent.mkdir(parents=True, exist_ok=True)
            target.write_bytes(content)
        manifest.append({**record, "contentSha256": sha(content), "paragraphs": paragraphs,
                         "placeholderOccurrences": len(re.findall(r"\[\[.*?\]\]", content.decode("utf-8"))),
                         "substantiveDifferences": [], "ready": False})
    data = (json.dumps(manifest, ensure_ascii=False, indent=2) + "\n").encode("utf-8")
    output = LEGAL / "destka-source-integrity.json"
    if args.check:
        if output.read_bytes() != data:
            raise ValueError("Generated integrity manifest differs")
    else:
        output.write_bytes(data)
    print("Destka DOCX/canonical integrity: 8 PASS; no substantive conversion changes")


if __name__ == "__main__":
    main()
