# /// script
# requires-python = ">=3.9"
# dependencies = [
#   "pyyaml",
# ]
# ///
import csv, datetime, os, re, html, shutil, yaml

results_dir = 'results'
filters_dir = 'filters'
output_dir = '_site'
os.makedirs(output_dir, exist_ok=True)

HTML_MAX_BYTES = 2_000_000

# 只提供下载、不制作 HTML 浏览页的输出（全文 infobox 类机器向输出、wikiBatch 批处理输入）
SKIP_HTML = {
    'stale-realname-annotations.csv',
    'alias-annotate.csv',
    'duplicate-staff-names.csv',
    'missing-cn-name-person.csv',
    'missing-cn-name-character.csv',
}

# 供下载的数据文件（非 results CSV）
DATA_FILES = ['person_alias.json.gz']

DARK_MODE = '''<style>
:root{color-scheme:light dark}
body{background:canvas;color:canvastext;font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,sans-serif;margin:20px}a{color:linktext}table{border-collapse:collapse;width:100%}th,td{border:1px solid color-mix(in srgb,canvastext 25%,transparent);padding:8px;text-align:left;vertical-align:top}th{background:color-mix(in srgb,canvastext 12%,transparent)}tr:nth-child(even){background:color-mix(in srgb,canvastext 6%,transparent)}
</style>'''


def filter_target(name):
    yaml_path = os.path.join(filters_dir, f'{name}.yaml')
    if os.path.exists(yaml_path):
        with open(yaml_path) as f:
            cfg = yaml.safe_load(f)
            if cfg and 'target' in cfg:
                return cfg['target']
    return 'subject'


def page_wrap(title, body):
    return ['<!DOCTYPE html>',
            '<html lang="zh"><head><meta charset="utf-8">',
            '<meta name="viewport" content="width=device-width,initial-scale=1">',
            '<meta name="text-scale" content="scale">',
            f'<title>{html.escape(title)}</title>',
            DARK_MODE,
            '</head><body>',
            *body,
            '</body></html>']


def csv_row_count(path):
    with open(path, newline='', encoding='utf-8-sig') as f:
        reader = csv.reader(f)
        next(reader, None)
        return sum(1 for _ in reader)


pages = []
downloads = []
for fname in sorted(os.listdir(results_dir)):
    if not fname.endswith('.csv'):
        continue
    src = os.path.join(results_dir, fname)
    shutil.copy(src, os.path.join(output_dir, fname))
    row_count = csv_row_count(src)
    downloads.append((fname, row_count))
    if fname in SKIP_HTML:
        continue
    if os.path.getsize(src) > HTML_MAX_BYTES:
        continue
    target = filter_target(fname[:-4])

    with open(os.path.join(results_dir, fname), newline='', encoding='utf-8-sig') as f:
        rows = list(csv.reader(f))
    if not rows:
        continue

    headers = rows[0]
    try:
        id_col = headers.index('id')
    except ValueError:
        id_col = -1

    body = [f'<h1>{html.escape(fname)}</h1>',
            f'<p>{len(rows) - 1} 行</p>',
            '<table><thead><tr>']
    for col in headers:
        body.append(f'<th>{html.escape(col)}</th>')
    body.append('</tr></thead><tbody>')
    for row in rows[1:]:
        body.append('<tr>')
        for i, cell in enumerate(row):
            if i == id_col and cell:
                body.append(f'<td><a href="https://bgm.tv/{target}/{html.escape(cell)}" target="_blank">{html.escape(cell)}</a></td>')
            else:
                body.append(f'<td>{html.escape(cell)}</td>')
        body.append('</tr>')
    body.append('</tbody></table>')

    h = page_wrap(fname, body)
    out_name = fname[:-4] + '.html'
    with open(os.path.join(output_dir, out_name), 'w') as f:
        f.write('\n'.join(h))
    pages.append((out_name, fname, row_count))

txt_src = 'duplicate_check_results.txt'
if os.path.exists(txt_src):
    with open(txt_src) as f:
        text = f.read()
    escaped_lines = []
    for line in text.split('\n'):
        escaped = html.escape(line)
        escaped = re.sub(r'(https://bgm\.tv/subject/\d+)', r'<a href="\1" target="_blank">\1</a>', escaped)
        escaped_lines.append(escaped)
    h = page_wrap('重复ISBN检查结果', [
        '<h1>重复ISBN检查结果</h1>',
        '<pre>',
        '\n'.join(escaped_lines),
        '</pre>',
    ])
    with open(os.path.join(output_dir, 'duplicate_check_results.html'), 'w') as f:
        f.write('\n'.join(h))
    pages.append(('duplicate_check_results.html', 'duplicate_check_results.txt', None))

data_links = []
for name in DATA_FILES:
    src = os.path.join(results_dir, '..', name)
    if not os.path.exists(src):
        continue
    shutil.copy(src, os.path.join(output_dir, name))
    data_links.append(name)
for entry in sorted(os.listdir(results_dir)):
    parts_dir = os.path.join(results_dir, entry)
    if not (os.path.isdir(parts_dir) and entry.endswith('_parts')):
        continue
    dst_dir = os.path.join(output_dir, entry)
    shutil.copytree(parts_dir, dst_dir, dirs_exist_ok=True)
    for pf in sorted(os.listdir(dst_dir)):
        if pf.endswith('.csv'):
            downloads.append((f'{entry}/{pf}', csv_row_count(os.path.join(dst_dir, pf))))
if data_links:
    with open(os.path.join(output_dir, 'data_version.txt'), 'w') as f:
        f.write(datetime.datetime.now().strftime('%Y-%m-%d'))
    print(f"已复制 {len(data_links)} 个数据文件到 _site/")

idx_body = ['<h1>Bangumi 筛选结果</h1>',
            '<h2>浏览结果</h2><ul>']
for out, src, row_count in pages:
    count_label = f'（{row_count} 条）' if row_count is not None else ''
    idx_body.append(f'<li><a href="{html.escape(out)}" target="_blank">{html.escape(src)}</a>{count_label}</li>')
if os.path.exists(os.path.join(output_dir, 'volume_order_report.html')):
    idx_body.append('<li><a href="volume_order_report.html" target="_blank">volume_order_report.html</a></li>')
if os.path.isdir(os.path.join(output_dir, 'missing-persons')):
    idx_body.append('<li><a href="missing-persons/" target="_blank">missing-persons</a></li>')
idx_body.append('</ul>')
if data_links or downloads:
    idx_body.append('<h2>下载文件</h2><ul>')
    for name in data_links:
        idx_body.append(f'<li><a href="{html.escape(name)}" download>{html.escape(name)}</a></li>')
    for name, row_count in downloads:
        idx_body.append(f'<li><a href="{html.escape(name)}" download>{html.escape(name)}</a>（{row_count} 条）</li>')
    idx_body.append('</ul>')
idx = page_wrap('筛选结果', idx_body)
with open(os.path.join(output_dir, 'index.html'), 'w') as f:
    f.write('\n'.join(idx))

print(f"已转换 {len(pages)} 个文件到 _site/")
