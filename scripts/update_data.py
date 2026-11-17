#!/usr/bin/env python3
"""Обновляет данные, вшитые в public/index.html, из CSV-выгрузки.

Использование:
    python scripts/update_data.py [путь/к/выгрузке.csv] [--check]

Без аргументов берётся registrations.csv из корня репозитория.
В страницу попадают только столбцы city, registered, source, paid:
имена и прочие столбцы отбрасываются.
--check ничего не записывает, а только проверяет, совпадает ли страница с CSV
(код возврата 1, если нет).
"""
import csv
import io
import re
import sys
from datetime import date
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
PAGE = ROOT / "public" / "index.html"
DEFAULT_CSV = ROOT / "registrations.csv"

# название столбца в выгрузке (в нижнем регистре) -> внутреннее имя
ALIASES = {
    "city": "city", "город": "city",
    "source": "source", "канал": "source", "источник": "source",
    "paid": "paid", "оплата": "paid", "оплачено": "paid",
    "registered": "registered", "дата": "registered",
    "дата регистрации": "registered", "регистрация": "registered",
}
YES = {"да", "yes", "true", "1", "y", "оплачено", "оплатил", "оплатила"}
NO = {"нет", "no", "false", "0", "n", "не оплачено", "не оплатил", "не оплатила"}
TOTAL = {"итого", "всего", "total"}
BLOCK = re.compile(r'(<script type="text/plain" id="csv">)(.*?)(</script>)', re.S)
HEADER = "city,registered,source,paid"


def fail(msg):
    sys.exit("ОШИБКА: " + msg)


def decode(raw):
    if raw[:2] in (b"\xff\xfe", b"\xfe\xff"):
        return raw.decode("utf-16"), "UTF-16"
    try:
        return raw.decode("utf-8-sig"), "UTF-8"
    except UnicodeDecodeError:
        return raw.decode("cp1251"), "Windows-1251"


def iso_date(s):
    """Принимает 2026-11-13 и 13.11.2026; иначе возвращает None."""
    s = s.strip()
    m = re.fullmatch(r"(\d{4})-(\d{2})-(\d{2})", s)
    if not m:
        m2 = re.fullmatch(r"(\d{1,2})\.(\d{1,2})\.(\d{4})", s)
        if not m2:
            return None
        m = (m2.group(3), m2.group(2), m2.group(1))
        y, mo, d = map(int, m)
    else:
        y, mo, d = map(int, m.groups())
    try:
        return date(y, mo, d).isoformat()
    except ValueError:
        return None


def clean(v):
    # запятые, переводы строк и кавычки сломали бы вшитый CSV
    return re.sub(r"[\r\n,;\"]+", " ", v).strip()


def build_rows(text):
    first = text.split("\n", 1)[0]
    delim = max(",;\t", key=first.count)
    reader = csv.reader(io.StringIO(text, newline=""), delimiter=delim)
    table = [r for r in reader if any(c.strip() for c in r)]
    if len(table) < 2:
        fail("в файле нет строк с данными.")

    cols = {}
    name_col = None
    for i, h in enumerate(table[0]):
        h = h.strip().lower()
        if h in ALIASES and ALIASES[h] not in cols:
            cols[ALIASES[h]] = i
        if h in ("name", "имя", "фио") and name_col is None:
            name_col = i
    missing = [c for c in ("city", "source", "paid") if c not in cols]
    if missing:
        fail("не найдены столбцы: %s. Нужны city/город, source/канал, paid/оплата." % ", ".join(missing))

    def cell(r, key):
        i = cols.get(key)
        return r[i].strip() if i is not None and i < len(r) else ""

    out, warns = [], []
    skipped = bad_dates = 0
    unknown = {}
    for n, r in enumerate(table[1:], start=2):
        city, source = cell(r, "city"), cell(r, "source")
        name = r[name_col].strip() if name_col is not None and name_col < len(r) else ""
        if any(v.lower().rstrip(":") in TOTAL for v in (city, source, name)):
            skipped += 1
            continue
        raw = cell(r, "paid")
        p = raw.lower()
        if p in YES:
            paid = "да"
        elif p in NO:
            paid = "нет"
        else:
            paid = raw  # страница сама предупредит о нераспознанном значении
            unknown[raw or "(пусто)"] = unknown.get(raw or "(пусто)", 0) + 1
        reg_raw = cell(r, "registered")
        reg = iso_date(reg_raw) if reg_raw else ""
        if reg is None:
            bad_dates += 1
            reg = ""
        out.append((clean(city), reg, clean(source), clean(paid)))

    if "registered" not in cols:
        warns.append("в выгрузке нет столбца с датой регистрации: дата данных на странице не покажется.")
    if skipped:
        warns.append("пропущено строк «Итого/Всего»: %d." % skipped)
    if bad_dates:
        warns.append("не распознано дат: %d (формат ГГГГ-ММ-ДД или ДД.ММ.ГГГГ), в этих строках дата пустая." % bad_dates)
    if unknown:
        warns.append("в столбце paid не распознано значений: %s. Страница посчитает их как «не оплатили»."
                     % ", ".join("«%s»: %d" % kv for kv in unknown.items()))
    empty = sum(1 for r in out if not r[0] or not r[2])
    if empty:
        warns.append("строк без города или канала: %d." % empty)
    names = [(r[name_col].strip().lower(), cell(r, "city").lower())
             for r in table[1:] if name_col is not None and name_col < len(r) and r[name_col].strip()]
    if len(names) != len(set(names)):
        warns.append("в выгрузке есть повторяющиеся участники (имя и город).")
    if not out:
        fail("после отбрасывания итоговых строк данных не осталось.")
    return out, warns


def main():
    # консоль Windows может не уметь часть символов: не падаем из-за вывода
    for stream in (sys.stdout, sys.stderr):
        if hasattr(stream, "reconfigure"):
            stream.reconfigure(errors="replace")
    args = [a for a in sys.argv[1:] if not a.startswith("--")]
    check = "--check" in sys.argv[1:]
    src = Path(args[0]) if args else DEFAULT_CSV
    if not src.is_file():
        fail("файл не найден: %s" % src)
    if not PAGE.is_file():
        fail("не найдена страница: %s" % PAGE)

    text, enc = decode(src.read_bytes())
    rows, warns = build_rows(text)
    block = HEADER + "\n" + "\n".join(",".join(r) for r in rows) + "\n"

    html = PAGE.read_text(encoding="utf-8")
    if len(BLOCK.findall(html)) != 1:
        fail('в %s должен быть ровно один блок <script type="text/plain" id="csv">.' % PAGE.name)
    current = BLOCK.search(html).group(2).strip()

    paid = sum(1 for r in rows if r[3] == "да")
    dates = [r[1] for r in rows if r[1]]
    print("Источник: %s (%s)" % (src, enc))
    print("Регистраций: %d, оплатили: %d, не оплатили: %d" % (len(rows), paid, len(rows) - paid))
    if dates:
        print("Последняя регистрация: %s" % max(dates))
    for w in warns:
        print("ВНИМАНИЕ: " + w)

    if check:
        same = current == block.strip()
        print("Страница совпадает с CSV." if same else "Страница НЕ совпадает с CSV: запустите скрипт без --check.")
        sys.exit(0 if same else 1)

    if current == block.strip():
        print("Страница уже содержит эти данные, ничего не изменено.")
        return
    new_html = BLOCK.sub(lambda m: m.group(1) + block + m.group(3), html, count=1)
    PAGE.write_text(new_html, encoding="utf-8", newline="")
    print("Готово: %s обновлён. Имена и другие столбцы в страницу не попали." % PAGE.relative_to(ROOT))
    print("Дальше: проверьте страницу и сделайте git commit + push.")


if __name__ == "__main__":
    main()
