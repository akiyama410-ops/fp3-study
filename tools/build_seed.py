#!/usr/bin/env python3
"""教材HTMLから、アプリに取り込むためのデータ(seed.json)を作るスクリプト。

使い方:
    python3 tools/build_seed.py <教材HTMLのフォルダ> <出力先.json>

できた seed.json は教材の中身を含むので、リポジトリには入れません
（.gitignore で除外しています）。アプリの「管理」画面から取り込みます。
"""
import json
import re
import sys
from pathlib import Path

# (id, 分野キー, 分野内の順番, ファイル名)
MATERIALS = [
    ("life1", "life", 1, "fp3_nenkin.html"),
    ("life2", "life", 2, "fp3_shogai_izoku.html"),
    ("life3", "life", 3, "fp3_shakaihoken.html"),
    ("life4", "life", 4, "fp3_life4.html"),
    ("risk1", "risk", 1, "fp3_risk1.html"),
    ("risk2", "risk", 2, "fp3_risk2.html"),
    ("risk3", "risk", 3, "fp3_risk3.html"),
    ("kinyu1", "kinyu", 1, "fp3_kinyu1.html"),
    ("kinyu2", "kinyu", 2, "fp3_kinyu2.html"),
    ("kinyu3", "kinyu", 3, "fp3_kinyu3.html"),
    ("tax1", "tax", 1, "fp3_shotokuzei.html"),
    ("tax2", "tax", 2, "fp3_tax2.html"),
    ("tax3", "tax", 3, "fp3_tax3.html"),
    ("fudosan1", "fudosan", 1, "fp3_fudosan1.html"),
    ("fudosan2", "fudosan", 2, "fp3_fudosan2.html"),
    ("fudosan3", "fudosan", 3, "fp3_fudosan3.html"),
    ("sozoku1", "sozoku", 1, "fp3_sozoku1.html"),
    ("sozoku2", "sozoku", 2, "fp3_sozoku2.html"),
    ("sozoku3", "sozoku", 3, "fp3_sozoku3.html"),
]

TAG = re.compile(r"<[^>]+>")


def text(html: str) -> str:
    return re.sub(r"\s+", " ", TAG.sub("", html)).strip()


def section(body: str, title_part: str) -> tuple[int, int, str]:
    """title_part を含む <h2> から次の <h2> までを返す (開始, 終了, 中身)。"""
    m = re.search(r"<h2>[^<]*" + re.escape(title_part) + r"[^<]*</h2>", body)
    if not m:
        raise ValueError(f"section not found: {title_part}")
    nxt = body.find("<h2>", m.end())
    end = nxt if nxt != -1 else len(body)
    return m.start(), end, body[m.end():end]


def top_level_items(ol_html: str) -> list[str]:
    """一番外側の <ol> の <li> を、入れ子を考えて取り出す。"""
    start = ol_html.find("<ol>")
    if start == -1:
        raise ValueError("ol not found")
    items, depth, i, cur = [], 0, start + 4, None
    while i < len(ol_html):
        if ol_html.startswith("<li>", i) or ol_html.startswith("<li ", i):
            if depth == 0:
                cur = i + ol_html[i:].find(">") + 1
            depth += 1
        elif ol_html.startswith("</li>", i):
            depth -= 1
            if depth == 0 and cur is not None:
                items.append(ol_html[cur:i])
                cur = None
        elif ol_html.startswith("</ol>", i) and depth == 0:
            break
        i += 1
    return items


def build(src: Path) -> dict:
    materials, questions = [], []
    for mid, field, order, fname in MATERIALS:
        raw = (src / fname).read_text(encoding="utf-8")
        body = raw[raw.find("<body>") + 6: raw.find("</body>")]
        title = text(re.search(r"<h1>(.*?)</h1>", body, re.S).group(1))
        title = re.sub(r"^FP3級\s*", "", title)

        q_start, q_end, q_html = section(body, "確認問題（○×）")
        a_start, a_end, a_html = section(body, "確認問題の答えと解説")
        qs = top_level_items(q_html)
        ans = top_level_items(a_html)
        if len(qs) != len(ans) or not qs:
            raise ValueError(f"{fname}: questions {len(qs)} vs answers {len(ans)}")
        for n, (q, a) in enumerate(zip(qs, ans), start=1):
            at = text(a)
            mark = at[:1]
            if mark not in ("○", "×"):
                raise ValueError(f"{fname} Q{n}: answer mark not found: {at[:10]}")
            expl = re.sub(r"^[○×]\s*[：:]\s*", "", at)
            questions.append({
                "id": f"{mid}-{n}",
                "material_id": mid,
                "sort": n,
                "text": text(q),
                "answer": mark == "○",
                "explanation": expl,
            })

        # 本文から○×問題と答えの部分、タイトル(h1)を外す（アプリでは別のタブで出す）
        content = body[:q_start] + body[a_end:]
        content = re.sub(r"<h1>.*?</h1>", "", content, count=1, flags=re.S).strip()
        materials.append({
            "id": mid,
            "field": field,
            "sort": order,
            "title": title,
            "content_html": content,
        })
    return {"version": 1, "materials": materials, "questions": questions}


def main() -> None:
    if len(sys.argv) != 3:
        print(__doc__)
        sys.exit(1)
    data = build(Path(sys.argv[1]))
    Path(sys.argv[2]).write_text(json.dumps(data, ensure_ascii=False), encoding="utf-8")
    print(f"materials={len(data['materials'])} questions={len(data['questions'])}")


if __name__ == "__main__":
    main()
