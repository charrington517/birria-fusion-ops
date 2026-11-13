#!/usr/bin/env python3
import sys

PATH = '/home/chancesr/birria-fusion-ops/client/src/App.jsx'
src = open(PATH, encoding='utf-8').read()
original = src

patches = [
    # 1. Pkg Qty input — add inputMode="decimal"
    (
        'step="0.001" min="0" value={form.pkg_qty} onChange={e=>set(\'pkg_qty\',e.target.value)} placeholder="e.g. 480"/>',
        'inputMode="decimal" step="0.001" min="0" value={form.pkg_qty} onChange={e=>set(\'pkg_qty\',e.target.value)} placeholder="e.g. 480"/>'
    ),
    # 2. Purchase Price input — add inputMode="decimal"
    (
        'step="0.01" min="0" value={form.purchase_price} onChange={e=>set(\'purchase_price\',e.target.value)} placeholder="e.g. 42.00"/>',
        'inputMode="decimal" step="0.01" min="0" value={form.purchase_price} onChange={e=>set(\'purchase_price\',e.target.value)} placeholder="e.g. 42.00"/>'
    ),
    # 3. Conv Factor input — add inputMode="decimal"
    (
        'step="0.0001" min="0" value={form.conversion_factor} onChange={e=>set(\'conversion_factor\',e.target.value)} placeholder="optional"/>',
        'inputMode="decimal" step="0.0001" min="0" value={form.conversion_factor} onChange={e=>set(\'conversion_factor\',e.target.value)} placeholder="optional"/>'
    ),
    # 4. PurchaseSyncConfirm button row — add className="purchase-actions"
    (
        "<div style={{display:'flex',gap:8,flexWrap:'wrap'}}>",
        '<div className="purchase-actions" style={{display:\'flex\',gap:8,flexWrap:\'wrap\'}}>'
    ),
    # 5. Ingredient link no-link row — add className="ing-link-row"
    (
        "{!showLinkPicker&&<div style={{display:'flex',alignItems:'center',gap:10}}>",
        '{!showLinkPicker&&<div className="ing-link-row" style={{display:\'flex\',alignItems:\'center\',gap:10}}>'
    ),
    # 6. Modal close button — comfortable tap target
    (
        "<div style={{display:'flex',justifyContent:'space-between',alignItems:'center',marginBottom:16}}>"
        "<h3 style={{margin:0}}>{isNew?'Add':'Edit'} Inventory Item</h3>"
        "<button onClick={onClose}>\xd7</button></div>",
        "<div style={{display:'flex',justifyContent:'space-between',alignItems:'center',marginBottom:16}}>"
        "<h3 style={{margin:0}}>{isNew?'Add':'Edit'} Inventory Item</h3>"
        "<button onClick={onClose} style={{minWidth:44,minHeight:44,fontSize:20,lineHeight:1}}>\xd7</button></div>"
    ),
]

errors = 0
for old, new in patches:
    if old not in src:
        print('ERROR: pattern not found: ' + old[:60], file=sys.stderr)
        errors += 1
        continue
    src = src.replace(old, new, 1)
    print('OK: ' + new[:60])

if errors:
    sys.exit(1)

if src == original:
    print('ERROR: no changes made', file=sys.stderr)
    sys.exit(1)

open(PATH, 'w', encoding='utf-8').write(src)
print('Patched ' + PATH)
