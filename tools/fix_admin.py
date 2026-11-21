with open('web/admin.js', 'r', encoding='utf-8') as f:
    content = f.read()

old = '''        </div>
      </div>
      <div class="row" style="gap:10px;margin-bottom:12px">
        <div class="field" style="flex:1">
          <label for="eiAltUnit">Alt Unit 1 (e.g. feet or pcs)</label>'''

new = '''        </div>
        <div class="field" style="flex:1">
          <label for="eiOrderUnit">Order Unit (default = main unit)</label>
          <input class="input" id="eiOrderUnit" value="${esc(item.order_unit || '')}" placeholder="pcs">
        </div>
      </div>
      <div class="row" style="gap:10px;margin-bottom:12px">
        <div class="field" style="flex:1">
          <label for="eiAltUnit">Alt Unit 1 (e.g. feet or pcs)</label>'''

if old in content:
    content = content.replace(old, new)
    with open('web/admin.js', 'w', encoding='utf-8') as f:
        f.write(content)
    print('REPLACED')
else:
    print('NOT FOUND')