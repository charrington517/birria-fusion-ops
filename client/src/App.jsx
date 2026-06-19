import React, { useEffect, useState, useCallback } from 'react';
import { createRoot } from 'react-dom/client';
import { Boxes, CalendarDays, ChefHat, ClipboardList, Home, Users, Wrench, Truck, Brain, ShieldCheck, LogOut, BookOpen, FlaskConical } from 'lucide-react';
import './style.css';

const nav = [
  ['today',      Home,         'Operations Today'],
  ['inventory',  Boxes,        'Inventory'],
  ['ingredients',Boxes,        'Ingredients'],
  ['compounds',  FlaskConical, 'Compounds'],
  ['recipes',    BookOpen,     'Recipes'],
  ['menu',       ChefHat,      'Menu'],
  ['catering',   ClipboardList,'Catering'],
  ['events',     CalendarDays, 'Events'],
  ['staff',      Users,        'Staff'],
  ['equipment',  Wrench,       'Assets'],
  ['suppliers',  Truck,        'Suppliers'],
  ['tasks',      ShieldCheck,  'Tasks'],
  ['playbook',   Brain,        'Playbook'],
  ['ai',         Brain,        'AI Copilot'],
];

const INV_CATEGORIES  = ['Food','Disposables','Supplies','Equipment','Other'];
const MENU_CATEGORIES = ['Entree','Appetizer','Side','Beverage','Dessert','Sauce','Signature','Fusion','Sandwich'];
const UNIT_OPTIONS    = ['lb','oz','kg','g','each','pack','case','bunch','slice','serving','qt','cup','tbsp','tsp','ml','liter'];
const RECIPE_CATEGORIES = ['Prep','Service','Signature','Sauce','Base','Fusion','Sandwich','Other'];
const COMPOUND_CATEGORIES = ['Broth','Protein','Sauce','Mix','Base','Marinade','Other'];

const fields = {
  catering:  ['client','date','guests','status','value','deposit','location','service_type','notes','readiness'],
  events:    ['name','date','location','status','expected_sales','notes'],
  staff:     ['name','role','status','hours','food_card_expiry','phone','notes'],
  equipment: ['name','status','location','qr_code','quantity_total','quantity_available','notes'],
  suppliers: ['name','category','phone','email','notes'],
  tasks:     ['title','category','status','priority','due_time','notes'],
  playbook:  ['title','category','content'],
};

const money = n => '$' + Number(n||0).toLocaleString(undefined,{minimumFractionDigits:2,maximumFractionDigits:2});
const pct   = n => Number(n||0).toFixed(1)+'%';
function marginColor(p){ if(p>=70) return '#86efac'; if(p>=50) return '#fde68a'; return '#fca5a5'; }
function marginLabel(p){ if(p>=70) return 'Excellent'; if(p>=60) return 'Good'; if(p>=50) return 'Watch'; return 'Low'; }
function stockColor(cur, min){ if(Number(cur)<=0) return '#fca5a5'; if(Number(cur)<=Number(min)) return '#fde68a'; return '#86efac'; }
function stockLabel(cur, min){ if(Number(cur)<=0) return 'Out'; if(Number(cur)<=Number(min)) return 'Low'; return 'OK'; }

// ── Auth ───────────────────────────────────────────────────────────────────────
function useApi() {
  const [token,setToken] = useState(localStorage.getItem('bf_token')||'');
  const [user, setUser]  = useState(JSON.parse(localStorage.getItem('bf_user')||'null'));
  async function api(path,opts={}) {
    const res = await fetch(path,{...opts,headers:{'Content-Type':'application/json',...(opts.headers||{}),...(token?{Authorization:`Bearer ${token}`}:{})}});
    if(!res.ok) throw new Error(await res.text());
    return res.json();
  }
  async function login(username,password) {
    const res = await fetch('/api/auth/login',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({username,password})});
    if(!res.ok) throw new Error(await res.text());
    const data = await res.json();
    localStorage.setItem('bf_token',data.token); localStorage.setItem('bf_user',JSON.stringify(data.user));
    setToken(data.token); setUser(data.user);
  }
  function logout(){ localStorage.removeItem('bf_token'); localStorage.removeItem('bf_user'); setToken(''); setUser(null); }
  return {token,user,api,login,logout};
}

// ── Shared ─────────────────────────────────────────────────────────────────────
function Login({login}) {
  const [err,setErr]=useState('');
  async function submit(e){ e.preventDefault(); setErr(''); const f=new FormData(e.currentTarget); try{await login(f.get('username'),f.get('password'));}catch{setErr('Login failed.');} }
  return <div className="login"><form className="card form" onSubmit={submit}>
    <div className="brand"><div className="logo">TF</div><div><h1>TruckFlow Ops</h1><p>Operations Intelligence</p></div></div>
    <input name="username" defaultValue="admin" placeholder="Username"/>
    <input name="password" defaultValue="admin123" type="password" placeholder="Password"/>
    {err&&<div className="badge red">{err}</div>}
    <button className="primary">Login</button>
  </form></div>;
}
function Metric({label,value,note}){ return <div className="card"><div className="metric-label">{label}</div><div className="metric-value">{value}</div><div className="muted">{note}</div></div>; }
function Badge({children,color=''}){ return <span className={`badge ${color}`}>{children}</span>; }
function Sel({value,onChange,options,style={}}){
  return <select value={value} onChange={e=>onChange(e.target.value)} style={{background:'rgba(255,255,255,.065)',border:'1px solid rgba(255,255,255,.1)',color:'white',borderRadius:12,padding:'11px 13px',width:'100%',fontSize:'inherit',...style}}>
    {options.map(o=><option key={o} value={o}>{o}</option>)}
  </select>;
}
const selectStyle = {background:'rgba(255,255,255,.065)',border:'1px solid rgba(255,255,255,.1)',color:'white',borderRadius:10,padding:'8px 10px',width:'100%',fontSize:'inherit'};

// ── App ────────────────────────────────────────────────────────────────────────
function App(){
  const auth=useApi();
  const [page,setPage]=useState('today');
  const [overview,setOverview]=useState(null);
  const [modal,setModal]=useState(null);
  const [aiPrompt,setAiPrompt]=useState('What needs attention today?');
  const [aiAnswer,setAiAnswer]=useState('');

  const refresh=useCallback(async()=>{ try{setOverview(await auth.api('/api/overview'));}catch{auth.logout();} },[auth.token]);
  useEffect(()=>{ if(auth.token) refresh(); },[auth.token]);

  if(!auth.token) return <Login login={auth.login}/>;
  if(!overview)  return <div className="login"><div className="card">Loading...</div></div>;

  const VERSION='v0.4.0';
  const title=nav.find(x=>x[0]===page)?.[2]||'TruckFlow Ops';
  const data=overview.data[page]||[];

  async function save(collection,item,id){
    await auth.api(`/api/${collection}${id?`/${id}`:''}`,{method:id?'PUT':'POST',body:JSON.stringify(item)});
    setModal(null); await refresh();
  }
  async function remove(collection,id){
    if(!confirm('Delete this item?')) return;
    try { await auth.api(`/api/${collection}/${id}`,{method:'DELETE'}); }
    catch(e) { alert(e.message); return; }
    await refresh();
  }

  return <div className="app">
    <aside className="sidebar">
      <div className="brand"><div className="logo">TF</div><div><h1>TruckFlow</h1><p>Operations Intelligence</p></div></div>
      {nav.map(([id,Icon,label])=><button key={id} onClick={()=>setPage(id)} className={`navbtn ${page===id?'active':''}`}><Icon size={18}/>{label}</button>)}
    </aside>
    <main className="main">
      <header className="topbar">
        <div><div className="kicker">Command Center · {auth.user?.role} · {VERSION}</div><h2>{title}</h2></div>
        <div className="actions"><button onClick={()=>setPage('ai')}>AI</button><button onClick={auth.logout}><LogOut size={16}/> Logout</button></div>
      </header>
      <section className="content">
        {page==='today'       && <Today overview={overview}/>}
        {page==='ai'          && <AiPage aiPrompt={aiPrompt} setAiPrompt={setAiPrompt} aiAnswer={aiAnswer} setAiAnswer={setAiAnswer} api={auth.api}/>}
        {page==='inventory'   && <InventoryPage items={data} api={auth.api} refresh={refresh}/>}
        {page==='ingredients' && <IngredientsPage ingredients={data} inventory={overview.data.inventory||[]} api={auth.api} refresh={refresh}/>}
        {page==='compounds'   && <CompoundsPage compounds={data} ingredients={overview.data.ingredients||[]} allCompounds={overview.data.compounds||[]} api={auth.api} refresh={refresh}/>}
        {page==='recipes'     && <RecipesPage recipes={data} ingredients={overview.data.ingredients||[]} api={auth.api} refresh={refresh}/>}
        {page==='menu'        && <MenuPage menuItems={data} recipes={overview.data.recipes||[]} allCompounds={overview.data.compounds||[]} ingredients={overview.data.ingredients||[]} api={auth.api} refresh={refresh}/>}
        {page==='events'      && <EventsPage events={data} menuItems={overview.data.menu||[]} api={auth.api} refresh={refresh} setModal={setModal} remove={remove}/>}
        {page!=='today'&&page!=='ai'&&page!=='inventory'&&page!=='ingredients'&&page!=='compounds'&&page!=='recipes'&&page!=='menu'&&page!=='events'&&
          <Collection page={page} data={data} setModal={setModal} remove={remove}/>}
      </section>
    </main>
    {modal&&<EditModal modal={modal} save={save} close={()=>setModal(null)}/>}
  </div>;
}

// ── Compounds Page ─────────────────────────────────────────────────────────────
function CompoundsPage({compounds, ingredients, allCompounds, api, refresh}){
  const [editing, setEditing] = useState(null);
  const [costs,   setCosts]   = useState({});

  useEffect(()=>{
    compounds.forEach(c=>{
      api(`/api/compound-ingredients/${c.id}/cost`)
        .then(d=>setCosts(m=>({...m,[c.id]:d})))
        .catch(()=>{});
    });
  },[compounds]);

  async function del(id){
    if(!confirm('Delete this compound ingredient? This cannot be undone.')) return;
    try { await api(`/api/compound-ingredients/${id}`,{method:'DELETE'}); }
    catch(e){ alert(e.message); return; }
    await refresh();
  }

  return <>
    <div className="card" style={{marginBottom:18,display:'flex',justifyContent:'space-between',alignItems:'center'}}>
      <div><h3>Compound Ingredients</h3><p className="muted">{compounds.length} items</p></div>
      <button className="primary" onClick={()=>setEditing({})}>Add Compound</button>
    </div>
    <div className="grid cards">
      {compounds.map(ci=>{
        const cost = costs[ci.id];
        return <div className="card" key={ci.id}>
          <div style={{display:'flex',justifyContent:'space-between',alignItems:'flex-start'}}>
            <div>
              <h3 style={{margin:'0 0 2px'}}>{ci.name}</h3>
              <span className="muted" style={{fontSize:12}}>{ci.category}</span>
            </div>
            <div style={{display:'flex',flexDirection:'column',alignItems:'flex-end',gap:4}}>
              <span className="badge" style={ci.active
                ? {background:'rgba(34,197,94,.18)',color:'#86efac'}
                : {background:'rgba(239,68,68,.2)',color:'#fca5a5'}}>
                {ci.active?'Active':'Inactive'}
              </span>
              {cost && <span style={{fontSize:14,fontWeight:900,color:'#86efac'}}>{money(cost.cost_per_yield_unit)}/{ci.yield_unit}</span>}
            </div>
          </div>

          <div className="inv-grid" style={{marginTop:10}}>
            <div className="inv-stat"><div className="muted" style={{fontSize:11}}>Yield</div><div style={{fontWeight:900}}>{ci.yield_amount} {ci.yield_unit}</div></div>
            <div className="inv-stat"><div className="muted" style={{fontSize:11}}>Batch Cost</div><div style={{color:'#fca5a5',fontWeight:900}}>{cost?money(cost.total_batch_cost):'...'}</div></div>
            <div className="inv-stat"><div className="muted" style={{fontSize:11}}>Cost / {ci.yield_unit}</div><div style={{color:'#86efac',fontWeight:900}}>{cost?money(cost.cost_per_yield_unit):'...'}</div></div>
            <div className="inv-stat"><div className="muted" style={{fontSize:11}}>Components</div><div>{cost?cost.components.length:0}</div></div>
          </div>

          {cost && cost.components.length>0 && <>
            <div className="muted" style={{fontSize:11,marginTop:10,marginBottom:4,textTransform:'uppercase',letterSpacing:'0.08em'}}>Components</div>
            {cost.components.map((comp,i)=><div key={i} className="profit-row" style={{fontSize:12}}>
              <span style={{display:'flex',alignItems:'center',gap:6}}>
                {comp.type==='compound' && <span className="badge" style={{fontSize:10,padding:'2px 6px',background:'rgba(168,85,247,.18)',color:'#d8b4fe'}}>COMPOUND</span>}
                {comp.name}
              </span>
              <span className="muted">×{comp.quantity} {comp.unit}</span>
              <span style={{color:'#fca5a5'}}>{money(comp.line_cost)}</span>
            </div>)}
          </>}

          {ci.notes && <p className="muted" style={{fontSize:12,marginTop:8}}>{ci.notes}</p>}

          <div className="actions" style={{marginTop:12}}>
            <button onClick={()=>setEditing(ci)}>Edit</button>
            <button onClick={()=>del(ci.id)}>Delete</button>
          </div>
        </div>;
      })}
    </div>
    {editing!==null && <CompoundModal compound={editing} ingredients={ingredients} allCompounds={allCompounds} api={api} onClose={()=>setEditing(null)} onSaved={()=>{ setEditing(null); refresh(); }}/>}
  </>;
}

function CompoundModal({compound, ingredients, allCompounds, api, onClose, onSaved}){
  const isNew = !compound.id;
  const [form, setForm] = useState({
    id: compound.id,
    name: compound.name||'',
    category: compound.category||'Broth',
    yield_amount: compound.yield_amount||1,
    yield_unit: compound.yield_unit||'qt',
    notes: compound.notes||'',
    active: compound.active!==false,
  });
  const [rows, setRows]     = useState([]);
  const [loading, setLoading] = useState(!isNew);
  const [saving,  setSaving]  = useState(false);
  const [error,   setError]   = useState('');
  const [preview, setPreview] = useState(null);

  function set(k,v){ setForm(f=>({...f,[k]:v})); }

  // Load existing components when editing
  useEffect(()=>{
    if(!compound.id){ setLoading(false); return; }
    api(`/api/compound-ingredient-components?parent_id=${compound.id}`)
      .then(data=>{
        setRows(data.map(r=>({
          id: r.id,
          type: r.ingredient_id ? 'ingredient' : 'compound',
          ingredient_id: r.ingredient_id||'',
          nested_compound_id: r.nested_compound_id||'',
          quantity: r.quantity,
          unit: r.unit,
          name: r.ingredient_name||r.nested_compound_name||''
        })));
        setLoading(false);
      })
      .catch(()=>setLoading(false));
  },[]);

  // Live cost preview
  useEffect(()=>{
    let total=0;
    rows.forEach(row=>{
      if(row.type==='ingredient' && row.ingredient_id){
        const ing=ingredients.find(i=>i.id===Number(row.ingredient_id));
        if(ing){ const spp=Number(ing.servings_per_purchase)||1; total+=(Number(ing.cost)/spp)*Number(row.quantity||0); }
      }
      // nested compound preview not computed live (avoid recursive API calls in modal)
    });
    const ya=Number(form.yield_amount)||1;
    setPreview({ total_batch_cost: total, cost_per_unit: total/ya });
  },[rows, form.yield_amount, ingredients]);

  function addRow(){ setRows(r=>[...r,{type:'ingredient',ingredient_id:'',nested_compound_id:'',quantity:1,unit:'each'}]); }
  function updateRow(i,k,v){ setRows(r=>r.map((row,idx)=>idx===i?{...row,[k]:v}:row)); }
  function removeRow(i){ setRows(r=>r.filter((_,idx)=>idx!==i)); }

  async function save(){
    if(!form.name.trim()){ setError('Name is required.'); return; }
    if(!form.yield_amount||Number(form.yield_amount)<=0){ setError('Yield amount must be > 0.'); return; }
    if(!form.yield_unit.trim()){ setError('Yield unit is required.'); return; }
    setSaving(true); setError('');
    try {
      // Upsert compound header
      const saved = await api(
        `/api/compound-ingredients${form.id?`/${form.id}`:''}`,
        { method: form.id?'PUT':'POST', body: JSON.stringify(form) }
      );
      const compId = form.id || saved.id;

      // Delete existing components then re-insert
      const existing = await api(`/api/compound-ingredient-components?parent_id=${compId}`);
      for(const r of existing){
        await api(`/api/compound-ingredient-components/${r.id}`,{method:'DELETE'}).catch(()=>{});
      }
      for(const row of rows){
        if(row.type==='ingredient'&&!row.ingredient_id) continue;
        if(row.type==='compound'&&!row.nested_compound_id) continue;
        if(!row.quantity||Number(row.quantity)<=0) continue;
        await api('/api/compound-ingredient-components',{
          method:'POST',
          body: JSON.stringify({
            parent_id: compId,
            ingredient_id: row.type==='ingredient' ? Number(row.ingredient_id) : null,
            nested_compound_id: row.type==='compound' ? Number(row.nested_compound_id) : null,
            quantity: Number(row.quantity),
            unit: row.unit
          })
        });
      }
      onSaved();
    } catch(e){
      setError(e.message);
    } finally {
      setSaving(false);
    }
  }

  // Filter out self from nested compound options (prevent direct self-reference)
  const nestableCompounds = allCompounds.filter(c => c.id !== compound.id);

  if(loading) return <div className="modal"><div className="modal-card"><p className="muted">Loading…</p></div></div>;

  return <div className="modal"><div className="modal-card" style={{width:'min(720px,100%)',maxHeight:'90vh',overflowY:'auto'}}>
    <div style={{display:'flex',justifyContent:'space-between',alignItems:'center',marginBottom:16}}>
      <h3 style={{margin:0}}>{isNew?'Add':'Edit'} Compound Ingredient</h3>
      <button onClick={onClose}>×</button>
    </div>
    <div className="form">
      <label><div className="muted">Name</div><input value={form.name} onChange={e=>set('name',e.target.value)} placeholder="e.g. Birria Consomé Base"/></label>
      <div style={{display:'grid',gridTemplateColumns:'1fr 1fr',gap:12}}>
        <label><div className="muted">Category</div><Sel value={form.category} onChange={v=>set('category',v)} options={COMPOUND_CATEGORIES}/></label>
        <label style={{display:'flex',alignItems:'center',gap:8,paddingTop:20}}>
          <input type="checkbox" checked={form.active} onChange={e=>set('active',e.target.checked)} style={{width:'auto'}}/>
          <span className="muted">Active</span>
        </label>
      </div>
      <div style={{display:'grid',gridTemplateColumns:'1fr 1fr',gap:12}}>
        <label><div className="muted">Yield Amount</div><input type="number" step="0.1" min="0.01" value={form.yield_amount} onChange={e=>set('yield_amount',e.target.value)}/></label>
        <label><div className="muted">Yield Unit</div><Sel value={form.yield_unit} onChange={v=>set('yield_unit',v)} options={UNIT_OPTIONS}/></label>
      </div>
      <label><div className="muted">Notes</div><textarea value={form.notes} onChange={e=>set('notes',e.target.value)} placeholder="Kitchen notes, batch instructions…"/></label>

      {/* Component Builder */}
      <div style={{display:'flex',justifyContent:'space-between',alignItems:'center',marginTop:8}}>
        <div style={{fontWeight:900}}>Components</div>
        <button onClick={addRow} style={{padding:'6px 12px'}}>+ Add Row</button>
      </div>

      {/* Column headers */}
      {rows.length>0 && <div style={{display:'grid',gridTemplateColumns:'90px 1fr 70px 80px 28px',gap:8,padding:'0 0 2px'}}>
        <div className="muted" style={{fontSize:11}}>Type</div>
        <div className="muted" style={{fontSize:11}}>Ingredient / Compound</div>
        <div className="muted" style={{fontSize:11}}>Qty</div>
        <div className="muted" style={{fontSize:11}}>Unit</div>
        <div/>
      </div>}

      {rows.map((row,i)=>{
        const ing = row.type==='ingredient' ? ingredients.find(ig=>ig.id===Number(row.ingredient_id)) : null;
        const spp = ing ? (Number(ing.servings_per_purchase)||1) : 1;
        const lineCost = ing ? ((Number(ing.cost)/spp)*Number(row.quantity||0)) : null;
        return <div key={i} style={{display:'grid',gridTemplateColumns:'90px 1fr 70px 80px 28px',gap:8,alignItems:'center',marginBottom:6}}>
          {/* Type toggle */}
          <select value={row.type} onChange={e=>updateRow(i,'type',e.target.value)} style={selectStyle}>
            <option value="ingredient">Ingredient</option>
            <option value="compound">Compound</option>
          </select>
          {/* Source picker */}
          {row.type==='ingredient'
            ? <select value={row.ingredient_id} onChange={e=>{ updateRow(i,'ingredient_id',e.target.value); const ig=ingredients.find(x=>x.id===Number(e.target.value)); if(ig) updateRow(i,'unit',ig.unit); }} style={selectStyle}>
                <option value="">Select ingredient…</option>
                {ingredients.map(ig=><option key={ig.id} value={ig.id}>{ig.name} ({ig.unit})</option>)}
              </select>
            : <select value={row.nested_compound_id} onChange={e=>{ updateRow(i,'nested_compound_id',e.target.value); const nc=nestableCompounds.find(x=>x.id===Number(e.target.value)); if(nc) updateRow(i,'unit',nc.yield_unit); }} style={selectStyle}>
                <option value="">Select compound…</option>
                {nestableCompounds.map(nc=><option key={nc.id} value={nc.id}>{nc.name} ({nc.yield_unit})</option>)}
              </select>
          }
          {/* Quantity */}
          <input type="number" step="0.01" min="0.01" value={row.quantity} onChange={e=>updateRow(i,'quantity',e.target.value)} style={{borderRadius:10,background:'rgba(255,255,255,.065)',border:'1px solid rgba(255,255,255,.1)',color:'white',padding:'8px'}}/>
          {/* Unit */}
          <input value={row.unit||''} onChange={e=>updateRow(i,'unit',e.target.value)} placeholder="unit" style={{borderRadius:10,background:'rgba(255,255,255,.065)',border:'1px solid rgba(255,255,255,.1)',color:'white',padding:'8px'}}/>
          {/* Remove */}
          <button onClick={()=>removeRow(i)} style={{padding:'4px 8px',background:'rgba(239,68,68,.3)'}}>×</button>
        </div>;
      })}

      {/* Live cost preview (simple ingredients only — compounds need API) */}
      {preview && rows.some(r=>r.type==='ingredient'&&r.ingredient_id) && <div className="profit-panel" style={{marginTop:4}}>
        <div className="profit-row">
          <span className="muted">Batch Cost (simple ingredients)</span>
          <span style={{color:'#fca5a5'}}>{money(preview.total_batch_cost)}</span>
        </div>
        <div className="profit-row">
          <span className="muted">Cost / {form.yield_unit||'unit'} (est.)</span>
          <span style={{color:'#86efac',fontWeight:900}}>{money(preview.cost_per_unit)}</span>
        </div>
        {rows.some(r=>r.type==='compound') && <div className="muted" style={{fontSize:11,marginTop:4}}>* Nested compound costs not included in preview — shown on card after save.</div>}
      </div>}

      {error && <div className="badge red" style={{borderRadius:10,padding:'8px 14px'}}>{error}</div>}
      <button className="primary" onClick={save} disabled={saving}>{saving?'Saving…':'Save Compound'}</button>
    </div>
  </div></div>;
}

// ── Inventory Page ─────────────────────────────────────────────────────────────
function InventoryPage({items, api, refresh}){
  const [editing,setEditing]=useState(null);
  async function save(form){ const id=form.id; await api(`/api/inventory${id?`/${id}`:''}`,{method:id?'PUT':'POST',body:JSON.stringify(form)}); setEditing(null); await refresh(); }
  async function del(id){ if(!confirm('Delete?')) return; await api(`/api/inventory/${id}`,{method:'DELETE'}); await refresh(); }
  const grouped={};
  items.forEach(item=>{ const c=item.category||'Other'; if(!grouped[c]) grouped[c]=[]; grouped[c].push(item); });
  const allCats = [...INV_CATEGORIES.filter(c=>grouped[c]?.length), ...Object.keys(grouped).filter(c=>!INV_CATEGORIES.includes(c))];
  return <>
    <div className="card" style={{marginBottom:18,display:'flex',justifyContent:'space-between',alignItems:'center'}}>
      <div><h3>Inventory</h3><p className="muted">{items.length} items</p></div>
      <button className="primary" onClick={()=>setEditing({})}>Add Item</button>
    </div>
    {allCats.map(cat=><div key={cat} style={{marginBottom:24}}>
      <div style={{color:'#fb923c',fontWeight:900,fontSize:13,textTransform:'uppercase',letterSpacing:'0.1em',marginBottom:10,borderBottom:'1px solid rgba(249,115,22,.3)',paddingBottom:6}}>{cat}</div>
      <div className="grid cards">
        {(grouped[cat]||[]).map(item=>{
          const sl=stockLabel(item.current_stock,item.min_stock);
          const sc=stockColor(item.current_stock,item.min_stock);
          return <div className="card" key={item.id}>
            <div style={{display:'flex',justifyContent:'space-between',alignItems:'flex-start'}}>
              <h3 style={{margin:'0 0 4px'}}>{item.name}</h3>
              <span className="badge" style={{background:sc==='#86efac'?'rgba(34,197,94,.18)':sc==='#fde68a'?'rgba(234,179,8,.18)':'rgba(239,68,68,.2)',color:sc,fontSize:11}}>{sl}</span>
            </div>
            <div className="inv-grid" style={{marginTop:8}}>
              <div className="inv-stat"><div className="muted" style={{fontSize:11}}>In Stock</div><div style={{fontWeight:900,color:sc}}>{Number(item.current_stock).toFixed(2)} {item.unit}</div></div>
              <div className="inv-stat"><div className="muted" style={{fontSize:11}}>Min / Max</div><div>{item.min_stock} / {item.max_stock||'—'} {item.unit}</div></div>
              <div className="inv-stat"><div className="muted" style={{fontSize:11}}>Unit Cost</div><div style={{color:'#fca5a5'}}>{money(item.cost)}</div></div>
              <div className="inv-stat"><div className="muted" style={{fontSize:11}}>Category</div><div>{item.category||'—'}</div></div>
            </div>
            {item.supplier&&<p className="muted" style={{fontSize:12,marginTop:6}}>Supplier: {item.supplier}</p>}
            <div className="actions" style={{marginTop:10}}><button onClick={()=>setEditing(item)}>Edit</button><button onClick={()=>del(item.id)}>Delete</button></div>
          </div>;
        })}
      </div>
    </div>)}
    {editing!==null&&<InventoryModal item={editing} onSave={save} onClose={()=>setEditing(null)}/>}
  </>;
}
function InventoryModal({item,onSave,onClose}){
  const isNew=!item.id;
  const [form,setForm]=useState({id:item.id,name:item.name||'',category:item.category||'Food',unit:item.unit||'each',current_stock:item.current_stock??'',min_stock:item.min_stock??'',max_stock:item.max_stock??'',cost:item.cost||'',supplier:item.supplier||'',forecast_per_event:item.forecast_per_event||''});
  function set(k,v){setForm(f=>({...f,[k]:v}));}
  return <div className="modal"><div className="modal-card">
    <div style={{display:'flex',justifyContent:'space-between',alignItems:'center',marginBottom:16}}><h3 style={{margin:0}}>{isNew?'Add':'Edit'} Inventory Item</h3><button onClick={onClose}>×</button></div>
    <div className="form">
      <label><div className="muted">Name</div><input value={form.name} onChange={e=>set('name',e.target.value)}/></label>
      <div style={{display:'grid',gridTemplateColumns:'1fr 1fr',gap:12}}>
        <label><div className="muted">Category</div><Sel value={form.category} onChange={v=>set('category',v)} options={INV_CATEGORIES}/></label>
        <label><div className="muted">Unit</div><Sel value={form.unit} onChange={v=>set('unit',v)} options={UNIT_OPTIONS}/></label>
      </div>
      <div style={{display:'grid',gridTemplateColumns:'1fr 1fr 1fr',gap:12}}>
        <label><div className="muted">Current Stock</div><input type="number" step="0.01" value={form.current_stock} onChange={e=>set('current_stock',e.target.value)}/></label>
        <label><div className="muted">Min Stock</div><input type="number" step="0.01" value={form.min_stock} onChange={e=>set('min_stock',e.target.value)}/></label>
        <label><div className="muted">Max Stock</div><input type="number" step="0.01" value={form.max_stock} onChange={e=>set('max_stock',e.target.value)}/></label>
      </div>
      <div style={{display:'grid',gridTemplateColumns:'1fr 1fr',gap:12}}>
        <label><div className="muted">Unit Cost ($)</div><input type="number" step="0.01" value={form.cost} onChange={e=>set('cost',e.target.value)}/></label>
        <label><div className="muted">Forecast / Event</div><input type="number" step="0.1" value={form.forecast_per_event} onChange={e=>set('forecast_per_event',e.target.value)}/></label>
      </div>
      <label><div className="muted">Supplier</div><input value={form.supplier} onChange={e=>set('supplier',e.target.value)}/></label>
      <button className="primary" onClick={()=>onSave(form)}>Save</button>
    </div>
  </div></div>;
}

// ── Ingredients Page ────────────────────────────────────────────────────────────
function IngredientsPage({ingredients,inventory,api,refresh}){
  const [editing,setEditing]=useState(null);
  const invMap=Object.fromEntries(inventory.map(i=>[String(i.id),i]));
  async function save(form){ const id=form.id; await api(`/api/ingredients${id?`/${id}`:''}`,{method:id?'PUT':'POST',body:JSON.stringify(form)}); setEditing(null); await refresh(); }
  async function del(id){ if(!confirm('Delete ingredient?')) return; await api(`/api/ingredients/${id}`,{method:'DELETE'}); await refresh(); }
  return <>
    <div className="card" style={{marginBottom:18,display:'flex',justifyContent:'space-between',alignItems:'center'}}>
      <div><h3>Ingredients</h3><p className="muted">{ingredients.length} records</p></div>
      <button className="primary" onClick={()=>setEditing({})}>Add Ingredient</button>
    </div>
    <div className="grid cards">
      {ingredients.map(ing=>{
        const spp=Number(ing.servings_per_purchase)||1;
        const cps=(Number(ing.cost)||0)/spp;
        const inv=invMap[String(ing.inventory_item_id)];
        return <div className="card" key={ing.id}>
          <div style={{display:'flex',justifyContent:'space-between',alignItems:'flex-start'}}>
            <h3 style={{margin:0}}>{ing.name}</h3>
            <span className="muted" style={{fontSize:12}}>{ing.category}</span>
          </div>
          <div className="profit-panel" style={{marginTop:10}}>
            <div className="profit-row"><span className="muted">Inventory Source</span><span>{inv?`${inv.name} (${inv.unit})`:<span style={{color:'#fca5a5',fontSize:12}}>not linked</span>}</span></div>
            <div className="profit-row"><span className="muted">Purchase Cost</span><span>{money(ing.cost)} / {ing.unit}</span></div>
            <div className="profit-row"><span className="muted">Servings / Purchase</span><span>{spp}</span></div>
            <div className="profit-row"><span className="muted">Cost Per Serving</span><span style={{color:'#86efac',fontWeight:900}}>{money(cps)} / {ing.unit}</span></div>
          </div>
          {ing.notes&&<p className="muted" style={{fontSize:12,marginTop:6}}>{ing.notes}</p>}
          <div className="actions" style={{marginTop:10}}><button onClick={()=>setEditing(ing)}>Edit</button><button onClick={()=>del(ing.id)}>Delete</button></div>
        </div>;
      })}
    </div>
    {editing!==null&&<IngredientModal ingredient={editing} inventory={inventory} onSave={save} onClose={()=>setEditing(null)}/>}
  </>;
}
function IngredientModal({ingredient,inventory,onSave,onClose}){
  const isNew=!ingredient.id;
  const [form,setForm]=useState({name:ingredient.name||'',category:ingredient.category||'',unit:ingredient.unit||'each',cost:ingredient.cost||'',servings_per_purchase:ingredient.servings_per_purchase||1,supplier:ingredient.supplier||'',notes:ingredient.notes||'',inventory_item_id:ingredient.inventory_item_id||'',id:ingredient.id});
  function set(k,v){setForm(f=>({...f,[k]:v}));}
  const cps=form.cost&&form.servings_per_purchase?(Number(form.cost)/Number(form.servings_per_purchase)).toFixed(4):'—';
  return <div className="modal"><div className="modal-card">
    <div style={{display:'flex',justifyContent:'space-between',alignItems:'center',marginBottom:16}}><h3 style={{margin:0}}>{isNew?'Add':'Edit'} Ingredient</h3><button onClick={onClose}>×</button></div>
    <div className="form">
      <label><div className="muted">Name</div><input value={form.name} onChange={e=>set('name',e.target.value)}/></label>
      <div style={{display:'grid',gridTemplateColumns:'1fr 1fr',gap:12}}>
        <label><div className="muted">Category</div><input value={form.category} onChange={e=>set('category',e.target.value)} placeholder="Meat, Produce…"/></label>
        <label><div className="muted">Unit</div><Sel value={form.unit} onChange={v=>set('unit',v)} options={UNIT_OPTIONS}/></label>
      </div>
      <div style={{display:'grid',gridTemplateColumns:'1fr 1fr',gap:12}}>
        <label><div className="muted">Purchase Cost ($)</div><input type="number" step="0.01" value={form.cost} onChange={e=>set('cost',e.target.value)}/></label>
        <label><div className="muted">Servings per Purchase</div><input type="number" step="1" min="1" value={form.servings_per_purchase} onChange={e=>set('servings_per_purchase',e.target.value)}/></label>
      </div>
      <div className="muted" style={{fontSize:12,padding:'6px 0'}}>Cost per serving: <strong style={{color:'#86efac'}}>${cps}</strong></div>
      <label><div className="muted">Supplier</div><input value={form.supplier} onChange={e=>set('supplier',e.target.value)}/></label>
      <label><div className="muted">Link to Inventory Item</div>
        <select value={form.inventory_item_id||''} onChange={e=>set('inventory_item_id',e.target.value||null)} style={{background:'rgba(255,255,255,.065)',border:'1px solid rgba(255,255,255,.1)',color:'white',borderRadius:12,padding:'11px 13px',width:'100%'}}>
          <option value="">— none —</option>
          {inventory.map(inv=><option key={inv.id} value={inv.id}>{inv.name} ({inv.unit})</option>)}
        </select>
      </label>
      <label><div className="muted">Notes</div><textarea value={form.notes} onChange={e=>set('notes',e.target.value)}/></label>
      <button className="primary" onClick={()=>onSave(form)}>Save Ingredient</button>
    </div>
  </div></div>;
}

// ── Recipes Page ────────────────────────────────────────────────────────────────
function RecipesPage({recipes,ingredients,api,refresh}){
  const [editing,setEditing]=useState(null);

  async function save(form,riRows){
    const id=form.id;
    const saved=await api(`/api/recipes${id?`/${id}`:''}`,{method:id?'PUT':'POST',body:JSON.stringify(form)});
    const recipeId=id||saved.id;
    const allRI=await api('/api/recipe-ingredients');
    const toDelete=allRI.filter?allRI.filter(r=>r.recipe_id===recipeId):[];
    for(const ri of toDelete) await api(`/api/recipe-ingredients/${ri.id}`,{method:'DELETE'}).catch(()=>{});
    for(const row of riRows){ if(!row.ingredient_id||!row.quantity) continue; await api('/api/recipe-ingredients',{method:'POST',body:JSON.stringify({recipe_id:recipeId,ingredient_id:row.ingredient_id,quantity:row.quantity,unit:row.unit})}); }
    setEditing(null); await refresh();
  }
  async function del(id){ if(!confirm('Delete recipe? This removes all ingredient assignments.')) return; await api(`/api/recipes/${id}`,{method:'DELETE'}); await refresh(); }

  return <>
    <div className="card" style={{marginBottom:18,display:'flex',justifyContent:'space-between',alignItems:'center'}}>
      <div><h3>Recipe Book</h3><p className="muted">{recipes.length} recipes</p></div>
      <button className="primary" onClick={()=>setEditing({riRows:[]})}>Add Recipe</button>
    </div>
    <div className="grid cards">
      {recipes.map(r=>(
        <RecipeCard key={r.id} recipe={r} ingredients={ingredients}
          onEdit={()=>setEditing({...r,riRows:[]})}
          onDelete={()=>del(r.id)}/>
      ))}
    </div>
    {editing!==null&&<RecipeModal recipe={editing} ingredients={ingredients} api={api} onSave={save} onClose={()=>setEditing(null)}/>}
  </>;
}

function RecipeCard({recipe, ingredients, onEdit, onDelete}){
  const [open, setOpen] = useState(false);
  const r = recipe;

  return <div className="card menu-card">
    {/* ── Compact header ───────────────────────────────────────────────── */}
    <div style={{display:'flex',justifyContent:'space-between',alignItems:'flex-start',cursor:'pointer'}}
         onClick={()=>setOpen(o=>!o)}>
      <div style={{flex:1,minWidth:0}}>
        <h3 style={{margin:'0 0 3px',fontSize:15}}>{r.name}</h3>
        <div style={{display:'flex',gap:10,flexWrap:'wrap'}}>
          <span className="muted" style={{fontSize:12}}>{r.category}</span>
          <span className="muted" style={{fontSize:12}}>Yield: {r.yield_amount} {r.yield_unit}</span>
          {r.prep_time&&<span className="muted" style={{fontSize:12}}>Prep: {r.prep_time}</span>}
          {r.cook_time&&<span className="muted" style={{fontSize:12}}>Cook: {r.cook_time}</span>}
        </div>
      </div>
      <span style={{fontSize:16,color:'#a1a1aa',userSelect:'none',marginLeft:8,flexShrink:0}}>{open?'▲':'▼'}</span>
    </div>

    {/* ── Expanded cookbook detail ─────────────────────────────────────── */}
    {open && <div style={{marginTop:12,paddingTop:12,borderTop:'1px solid rgba(255,255,255,.08)'}}>

      {/* Timing + yield summary */}
      <div className="inv-grid" style={{marginBottom:12}}>
        <div className="inv-stat"><div className="muted" style={{fontSize:11}}>Yield</div><div>{r.yield_amount} {r.yield_unit}</div></div>
        <div className="inv-stat"><div className="muted" style={{fontSize:11}}>Prep</div><div>{r.prep_time||'—'}</div></div>
        <div className="inv-stat"><div className="muted" style={{fontSize:11}}>Cook</div><div>{r.cook_time||'—'}</div></div>
        <div className="inv-stat"><div className="muted" style={{fontSize:11}}>Category</div><div>{r.category}</div></div>
      </div>

      {/* Ingredient reference list (kitchen display — no cost column) */}
      <IngredientRef recipeId={r.id} ingredients={ingredients}/>

      {/* Instructions */}
      {r.instructions && <>
        <div className="muted" style={{fontSize:11,marginTop:12,marginBottom:6,textTransform:'uppercase',letterSpacing:'0.08em'}}>Instructions</div>
        <div style={{fontSize:13,lineHeight:1.7,whiteSpace:'pre-line',color:'#f8fafc',background:'rgba(255,255,255,.025)',borderRadius:10,padding:'10px 14px'}}>
          {r.instructions}
        </div>
      </>}

      {/* Notes */}
      {r.notes && <>
        <div className="muted" style={{fontSize:11,marginTop:10,marginBottom:4,textTransform:'uppercase',letterSpacing:'0.08em'}}>Notes</div>
        <p className="muted" style={{fontSize:12,margin:0,fontStyle:'italic'}}>{r.notes}</p>
      </>}

      <div className="actions" style={{marginTop:12}}>
        <button onClick={e=>{e.stopPropagation();onEdit();}}>Edit</button>
        <button onClick={e=>{e.stopPropagation();onDelete();}}>Delete</button>
      </div>
    </div>}
  </div>;
}

function IngredientRef({recipeId, ingredients}){
  const [rows, setRows] = useState(null);
  useEffect(()=>{
    fetch(`/api/recipe-ingredients?recipe_id=${recipeId}`, {
      headers: { Authorization: `Bearer ${localStorage.getItem('bf_token')||''}` }
    }).then(r=>r.json()).then(setRows).catch(()=>setRows([]));
  },[recipeId]);
  if(!rows || rows.length===0) return null;
  return <>
    <div className="muted" style={{fontSize:11,marginBottom:6,textTransform:'uppercase',letterSpacing:'0.08em'}}>Ingredients</div>
    {rows.map((row,i)=>{
      const ing = ingredients.find(ig=>ig.id===row.ingredient_id);
      return <div key={i} className="profit-row" style={{fontSize:12}}>
        <span>{ing?ing.name:row.ingredient_id}</span>
        <span className="muted">×{row.quantity} {row.unit}</span>
      </div>;
    })}
  </>;
}
function RecipeModal({recipe,ingredients,api,onSave,onClose}){
  const isNew=!recipe.id;
  const [form,setForm]=useState({id:recipe.id,name:recipe.name||'',category:recipe.category||'Prep',yield_amount:recipe.yield_amount||1,yield_unit:recipe.yield_unit||'serving',prep_time:recipe.prep_time||'',cook_time:recipe.cook_time||'',notes:recipe.notes||'',instructions:recipe.instructions||''});
  const [rows,setRows]=useState([]);
  const [loading,setLoading]=useState(!isNew);
  const [totalCost,setTotal]=useState(0);
  function set(k,v){setForm(f=>({...f,[k]:v}));}
  useEffect(()=>{ if(!recipe.id){setLoading(false);return;} api('/api/recipe-ingredients').then(all=>{ const mine=all.filter(r=>r.recipe_id===recipe.id); setRows(mine.map(r=>({id:r.id,ingredient_id:r.ingredient_id,quantity:r.quantity,unit:r.unit}))); setLoading(false); }).catch(()=>setLoading(false)); },[]);
  useEffect(()=>{ let t=0; rows.forEach(row=>{ const ing=ingredients.find(i=>i.id===Number(row.ingredient_id)); if(ing){const spp=Number(ing.servings_per_purchase)||1; t+=(Number(ing.cost)/spp)*(Number(row.quantity)||0);} }); setTotal(t); },[rows,ingredients]);
  function addRow(){setRows(r=>[...r,{ingredient_id:'',quantity:1,unit:'each'}]);}
  function updateRow(i,k,v){setRows(r=>r.map((row,idx)=>idx===i?{...row,[k]:v}:row));}
  function removeRow(i){setRows(r=>r.filter((_,idx)=>idx!==i));}
  if(loading) return <div className="modal"><div className="modal-card"><p className="muted">Loading…</p></div></div>;
  return <div className="modal"><div className="modal-card" style={{width:'min(700px,100%)',maxHeight:'90vh',overflowY:'auto'}}>
    <div style={{display:'flex',justifyContent:'space-between',alignItems:'center',marginBottom:16}}><h3 style={{margin:0}}>{isNew?'Add':'Edit'} Recipe</h3><button onClick={onClose}>×</button></div>
    <div className="form">
      <label><div className="muted">Recipe Name</div><input value={form.name} onChange={e=>set('name',e.target.value)}/></label>
      <div style={{display:'grid',gridTemplateColumns:'1fr 1fr',gap:12}}>
        <label><div className="muted">Category</div><Sel value={form.category} onChange={v=>set('category',v)} options={RECIPE_CATEGORIES}/></label>
        <div style={{display:'grid',gridTemplateColumns:'1fr 1fr',gap:8}}>
          <label><div className="muted">Yield Amount</div><input type="number" step="0.1" value={form.yield_amount} onChange={e=>set('yield_amount',e.target.value)}/></label>
          <label><div className="muted">Yield Unit</div><input value={form.yield_unit} onChange={e=>set('yield_unit',e.target.value)} placeholder="serving…"/></label>
        </div>
      </div>
      <div style={{display:'grid',gridTemplateColumns:'1fr 1fr',gap:12}}>
        <label><div className="muted">Prep Time</div><input value={form.prep_time} onChange={e=>set('prep_time',e.target.value)} placeholder="30 min"/></label>
        <label><div className="muted">Cook Time</div><input value={form.cook_time} onChange={e=>set('cook_time',e.target.value)} placeholder="2 hours"/></label>
      </div>
      <label><div className="muted">Notes</div><textarea value={form.notes} onChange={e=>set('notes',e.target.value)}/></label>
      <label><div className="muted">Instructions</div><textarea rows={4} value={form.instructions} onChange={e=>set('instructions',e.target.value)} placeholder="Step-by-step…"/></label>
      <div style={{display:'flex',justifyContent:'space-between',alignItems:'center',marginTop:8}}><div style={{fontWeight:900}}>Ingredients</div><button onClick={addRow} style={{padding:'6px 12px'}}>+ Add Row</button></div>
      {rows.map((row,i)=>{ const ing=ingredients.find(ig=>ig.id===Number(row.ingredient_id)); const spp=ing?(Number(ing.servings_per_purchase)||1):1; const lineCost=ing?((Number(ing.cost)/spp)*(Number(row.quantity)||0)):0;
        return <div key={i} style={{display:'grid',gridTemplateColumns:'2fr 80px 80px 60px 28px',gap:8,alignItems:'center',marginBottom:4}}>
          <select value={row.ingredient_id} onChange={e=>updateRow(i,'ingredient_id',e.target.value)} style={{background:'rgba(255,255,255,.065)',border:'1px solid rgba(255,255,255,.1)',color:'white',borderRadius:10,padding:'8px 10px'}}><option value="">Select ingredient…</option>{ingredients.map(ig=><option key={ig.id} value={ig.id}>{ig.name} ({ig.unit})</option>)}</select>
          <input type="number" step="0.01" value={row.quantity} onChange={e=>updateRow(i,'quantity',e.target.value)} style={{borderRadius:10,background:'rgba(255,255,255,.065)',border:'1px solid rgba(255,255,255,.1)',color:'white',padding:'8px'}}/>
          <input value={row.unit||ing?.unit||''} onChange={e=>updateRow(i,'unit',e.target.value)} placeholder="unit" style={{borderRadius:10,background:'rgba(255,255,255,.065)',border:'1px solid rgba(255,255,255,.1)',color:'white',padding:'8px'}}/>
          <div style={{textAlign:'right',fontSize:12,color:'#86efac'}}>{money(lineCost)}</div>
          <button onClick={()=>removeRow(i)} style={{padding:'4px 8px',background:'rgba(239,68,68,.3)'}}>×</button>
        </div>;
      })}
      <div style={{textAlign:'right',fontWeight:900,marginTop:4}}>Total: <span style={{color:'#86efac'}}>{money(totalCost)}</span></div>
      <button className="primary" onClick={()=>onSave(form,rows)}>Save Recipe</button>
    </div>
  </div></div>;
}

// ── Menu Page ──────────────────────────────────────────────────────────────────
function MenuPage({menuItems,recipes,allCompounds,ingredients,api,refresh}){
  const [costs,setCosts]=useState({});
  const [editing,setEditing]=useState(null);

  useEffect(()=>{
    api('/api/menu/costs').then(all=>{
      const cm={};
      all.forEach(c=>{ cm[c.menu_item_id]=c; });
      setCosts(cm);
    }).catch(()=>{});
  },[menuItems]);

  async function save(form){ const id=form.id; await api(`/api/menu${id?`/${id}`:''}`,{method:id?'PUT':'POST',body:JSON.stringify(form)}); setEditing(null); await refresh(); }
  async function duplicate(item){ const {id,created_at,...rest}=item; await api('/api/menu',{method:'POST',body:JSON.stringify({...rest,name:`${item.name} (copy)`})}); await refresh(); }
  async function del(id){ if(!confirm('Delete menu item?')) return; await api(`/api/menu/${id}`,{method:'DELETE'}); await refresh(); }

  const grouped={};
  menuItems.forEach(item=>{ const c=item.category||'Uncategorized'; if(!grouped[c]) grouped[c]=[]; grouped[c].push(item); });

  return <>
    <div className="card" style={{marginBottom:18,display:'flex',justifyContent:'space-between',alignItems:'center'}}>
      <div><h3>Menu</h3><p className="muted">{menuItems.length} items</p></div>
      <button className="primary" onClick={()=>setEditing({})}>Add Item</button>
    </div>
    {Object.keys(grouped).sort().map(cat=><div key={cat} style={{marginBottom:24}}>
      <div style={{color:'#fb923c',fontWeight:900,fontSize:13,textTransform:'uppercase',letterSpacing:'0.1em',marginBottom:10,borderBottom:'1px solid rgba(249,115,22,.3)',paddingBottom:6}}>{cat}</div>
      <div className="grid cards">
        {grouped[cat].map(item=>(
          <MenuCard key={item.id} item={item} cost={costs[item.id]}
            onEdit={()=>setEditing(item)}
            onDuplicate={()=>duplicate(item)}
            onDelete={()=>del(item.id)}/>
        ))}
      </div>
    </div>)}
    {editing!==null&&<MenuItemModal item={editing} recipes={recipes} allCompounds={allCompounds} ingredients={ingredients||[]} api={api} onSave={save} onClose={()=>setEditing(null)}/>}
  </>;
}

function MenuCard({item, cost, onEdit, onDuplicate, onDelete}){
  const [open, setOpen] = useState(false);
  const c = cost;
  const rcost  = c ? c.recipe_cost : Number(item.cost);
  const mgn    = c ? c.gross_margin_percent : (item.price>0?((item.price-item.cost)/item.price)*100:0);
  const profit = Number(item.price) - rcost;
  const src    = c ? c.cost_source : 'manual';
  const s65    = rcost>0 ? Number((rcost/(1-0.65)).toFixed(2)) : null;
  const s70    = rcost>0 ? Number((rcost/(1-0.70)).toFixed(2)) : null;
  const s75    = rcost>0 ? Number((rcost/(1-0.75)).toFixed(2)) : null;

  return <div className="card menu-card">
    {/* ── Compact header — always visible ─────────────────────────────── */}
    <div style={{display:'flex',justifyContent:'space-between',alignItems:'flex-start',cursor:'pointer'}}
         onClick={()=>setOpen(o=>!o)}>
      <div style={{flex:1,minWidth:0}}>
        <div style={{display:'flex',alignItems:'center',gap:6,flexWrap:'wrap'}}>
          <h3 style={{margin:0,fontSize:15}}>{item.name}</h3>
          {!item.active&&<span className="badge" style={{background:'rgba(239,68,68,.2)',color:'#fca5a5',fontSize:10}}>INACTIVE</span>}
        </div>
        <div style={{display:'flex',gap:12,marginTop:4,flexWrap:'wrap'}}>
          <span style={{fontSize:12,color:'#fca5a5'}}>Cost {money(rcost)}</span>
          <span style={{fontSize:12,color:'#86efac'}}>Profit {money(profit)}</span>
          <span style={{fontSize:12,color:marginColor(mgn),fontWeight:700}}>{marginLabel(mgn)} {pct(mgn)}</span>
        </div>
      </div>
      <div style={{display:'flex',alignItems:'center',gap:8,flexShrink:0,marginLeft:8}}>
        <div style={{fontSize:20,fontWeight:900}}>{money(item.price)}</div>
        <span style={{fontSize:16,color:'#a1a1aa',userSelect:'none'}}>{open?'▲':'▼'}</span>
      </div>
    </div>

    {/* ── Expanded detail ──────────────────────────────────────────────── */}
    {open && <div style={{marginTop:12,paddingTop:12,borderTop:'1px solid rgba(255,255,255,.08)'}}>
      {item.description&&<p className="muted" style={{fontSize:12,margin:'0 0 10px'}}>{item.description}</p>}

      <div className="profit-panel" style={{marginTop:0}}>
        {c?.recipe_name&&<div className="profit-row"><span className="muted">Recipe</span><span>{c.recipe_name}</span></div>}
        <div className="profit-row"><span className="muted">Food Cost <span style={{fontSize:10,opacity:.6}}>({src})</span></span><span style={{color:'#fca5a5',fontWeight:900}}>{money(rcost)}</span></div>
        <div className="profit-row"><span className="muted">Actual Price</span><span style={{fontWeight:900}}>{money(item.price)}</span></div>
        <div className="profit-row"><span className="muted">Profit / Plate</span><span style={{color:'#86efac',fontWeight:900}}>{money(profit)}</span></div>
        <div className="profit-row"><span className="muted">Margin</span><span style={{color:marginColor(mgn),fontWeight:900}}>{pct(mgn)}</span></div>

        {s65&&<>
          <div className="muted" style={{fontSize:11,marginTop:8,marginBottom:4,textTransform:'uppercase',letterSpacing:'0.08em'}}>Suggested Price</div>
          <div style={{display:'grid',gridTemplateColumns:'1fr 1fr 1fr',gap:6}}>
            <div className="sug-price" style={{borderColor:Number(item.price)>=s65?'#86efac':'rgba(255,255,255,.1)'}}><div className="muted" style={{fontSize:10}}>65%</div><div style={{fontWeight:900,fontSize:14}}>{money(s65)}</div></div>
            <div className="sug-price" style={{borderColor:Number(item.price)>=s70?'#86efac':'rgba(255,255,255,.1)'}}><div className="muted" style={{fontSize:10}}>70%</div><div style={{fontWeight:900,fontSize:14}}>{money(s70)}</div></div>
            <div className="sug-price" style={{borderColor:Number(item.price)>=s75?'#86efac':'rgba(255,255,255,.1)'}}><div className="muted" style={{fontSize:10}}>75%</div><div style={{fontWeight:900,fontSize:14}}>{money(s75)}</div></div>
          </div>
        </>}

        {c?.ingredient_lines?.length>0&&<>
          <div className="muted" style={{fontSize:11,marginTop:8,marginBottom:4,textTransform:'uppercase',letterSpacing:'0.08em'}}>Ingredients</div>
          {c.ingredient_lines.map((l,i)=><div key={i} className="profit-row" style={{fontSize:12}}>
            <span>{l.ingredient}</span><span className="muted">×{l.quantity} {l.unit}</span><span style={{color:'#fca5a5'}}>{money(l.line_cost)}</span>
          </div>)}
        </>}

        {c?.compound_lines?.length>0&&<>
          <div className="muted" style={{fontSize:11,marginTop:6,marginBottom:4,textTransform:'uppercase',letterSpacing:'0.08em'}}>Compound Ingredients</div>
          {c.compound_lines.map((l,i)=><div key={i} className="profit-row" style={{fontSize:12}}>
            <span style={{display:'flex',alignItems:'center',gap:6}}><span className="badge" style={{fontSize:10,padding:'2px 5px',background:'rgba(168,85,247,.18)',color:'#d8b4fe'}}>C</span>{l.compound_name}</span>
            <span className="muted">×{l.quantity} {l.unit}</span>
            <span style={{color:'#fca5a5'}}>{money(l.line_cost)}</span>
          </div>)}
        </>}

        {item.prep_notes&&<>
          <div className="muted" style={{fontSize:11,marginTop:8,marginBottom:4,textTransform:'uppercase',letterSpacing:'0.08em'}}>Prep Notes</div>
          <div className="profit-row" style={{fontSize:12}}><span>{item.prep_notes}</span></div>
        </>}
      </div>

      <div className="actions" style={{marginTop:10,flexWrap:'wrap'}}>
        <button onClick={e=>{e.stopPropagation();onEdit();}}>Edit</button>
        <button onClick={e=>{e.stopPropagation();onDuplicate();}}>Duplicate</button>
        <button onClick={e=>{e.stopPropagation();onDelete();}}>Delete</button>
      </div>
    </div>}
  </div>;
}
function MenuItemModal({item,recipes,allCompounds,ingredients,api,onSave,onClose}){
  const isNew=!item.id;
  const [form,setForm]=useState({id:item.id,name:item.name||'',category:item.category||'Entree',price:item.price||'',description:item.description||'',prep_notes:item.prep_notes||'',active:item.active!==false,recipe_id:item.recipe_id||'',portions:item.portions||1});
  const [ingRows,  setIngRows]   = useState([]);
  const [compRows, setCompRows]  = useState([]);
  const [compCosts, setCompCosts] = useState({});
  const [loadingComp, setLoadingComp] = useState(!isNew);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState('');
  function set(k,v){setForm(f=>({...f,[k]:v}));}

  useEffect(()=>{
    if(!item.id){ setLoadingComp(false); return; }
    Promise.all([
      api(`/api/menu-item-ingredients?menu_item_id=${item.id}`),
      api(`/api/menu-item-compound-ingredients?menu_item_id=${item.id}`)
    ]).then(([ingData, compData])=>{
      setIngRows(ingData.map(r=>({id:r.id,ingredient_id:r.ingredient_id,quantity:r.quantity,unit:r.unit})));
      setCompRows(compData.map(r=>({id:r.id,compound_ingredient_id:r.compound_ingredient_id,quantity:r.quantity,unit:r.unit})));
      setLoadingComp(false);
      compData.forEach(r=>fetchCompCost(r.compound_ingredient_id));
    }).catch(()=>setLoadingComp(false));
  },[]);

  function fetchCompCost(cid){
    if(!cid||compCosts[cid]!==undefined) return;
    setCompCosts(prev=>({...prev,[cid]:'loading'}));
    api(`/api/compound-ingredients/${cid}/cost`)
      .then(d=>setCompCosts(prev=>({...prev,[cid]:d.cost_per_yield_unit})))
      .catch(()=>setCompCosts(prev=>({...prev,[cid]:null})));
  }

  async function save(){
    if(!form.name.trim()){ setSaveError('Name is required.'); return; }
    if(!form.price||Number(form.price)<=0){ setSaveError('Price must be > 0.'); return; }
    setSaving(true); setSaveError('');
    try{
      const payload={...form, recipe_id: form.recipe_id ? Number(form.recipe_id) : null};
      const saved = await api(`/api/menu${form.id?`/${form.id}`:''}`,{method:form.id?'PUT':'POST',body:JSON.stringify(payload)});
      const menuId = form.id || saved.id;
      const existingIng = await api(`/api/menu-item-ingredients?menu_item_id=${menuId}`);
      for(const r of existingIng) await api(`/api/menu-item-ingredients/${r.id}`,{method:'DELETE'}).catch(()=>{});
      for(const row of ingRows){
        if(!row.ingredient_id||!row.quantity||Number(row.quantity)<=0) continue;
        await api('/api/menu-item-ingredients',{method:'POST',body:JSON.stringify({menu_item_id:menuId,ingredient_id:Number(row.ingredient_id),quantity:Number(row.quantity),unit:row.unit})});
      }
      const existingComp = await api(`/api/menu-item-compound-ingredients?menu_item_id=${menuId}`);
      for(const r of existingComp) await api(`/api/menu-item-compound-ingredients/${r.id}`,{method:'DELETE'}).catch(()=>{});
      for(const row of compRows){
        if(!row.compound_ingredient_id||!row.quantity||Number(row.quantity)<=0) continue;
        await api('/api/menu-item-compound-ingredients',{method:'POST',body:JSON.stringify({menu_item_id:menuId,compound_ingredient_id:Number(row.compound_ingredient_id),quantity:Number(row.quantity),unit:row.unit})});
      }
      onSave(form);
    }catch(e){
      console.error('MenuItemModal save error:', e);
      setSaveError(e.message||'Save failed. Check console.');
    }finally{
      setSaving(false);
    }
  }

  function addIngRow(){ setIngRows(r=>[...r,{ingredient_id:'',quantity:1,unit:'each'}]); }
  function updateIng(i,k,v){ setIngRows(r=>r.map((row,idx)=>idx===i?{...row,[k]:v}:row)); }
  function removeIng(i){ setIngRows(r=>r.filter((_,idx)=>idx!==i)); }

  function addCompRow(){ setCompRows(r=>[...r,{compound_ingredient_id:'',quantity:1,unit:''}]); }
  function updateComp(i,k,v){
    setCompRows(r=>r.map((row,idx)=>{
      if(idx!==i) return row;
      const updated={...row,[k]:v};
      if(k==='compound_ingredient_id') fetchCompCost(Number(v));
      return updated;
    }));
  }
  function removeComp(i){ setCompRows(r=>r.filter((_,idx)=>idx!==i)); }

  const ingSubtotal = ingRows.reduce((sum,row)=>{
    const ing=ingredients.find(ig=>ig.id===Number(row.ingredient_id));
    if(!ing) return sum;
    const spp=Number(ing.servings_per_purchase)||1;
    return sum+(Number(ing.cost)/spp)*(Number(row.quantity)||0);
  },0);

  const compSubtotal = compRows.reduce((sum,row)=>{
    const cpu=compCosts[Number(row.compound_ingredient_id)];
    if(!cpu||cpu==='loading') return sum;
    return sum+Number(cpu)*(Number(row.quantity)||0);
  },0);

  const totalCost = ingSubtotal + compSubtotal;
  const menuPrice = Number(form.price)||0;
  const margin = menuPrice>0 ? ((menuPrice-totalCost)/menuPrice)*100 : null;

  if(loadingComp) return <div className="modal"><div className="modal-card"><p className="muted">Loading…</p></div></div>;

  return <div className="modal"><div className="modal-card" style={{maxHeight:'90vh',overflowY:'auto'}}>
    <div style={{display:'flex',justifyContent:'space-between',alignItems:'center',marginBottom:16}}><h3 style={{margin:0}}>{isNew?'Add':'Edit'} Menu Item</h3><button onClick={onClose}>×</button></div>
    <div className="form">
      <label><div className="muted">Name</div><input value={form.name} onChange={e=>set('name',e.target.value)}/></label>
      <div style={{display:'grid',gridTemplateColumns:'1fr 1fr',gap:12}}>
        <label><div className="muted">Category</div><Sel value={form.category} onChange={v=>set('category',v)} options={MENU_CATEGORIES}/></label>
        <label><div className="muted">Price ($)</div><input type="number" step="0.01" value={form.price} onChange={e=>set('price',e.target.value)}/></label>
      </div>
      <div style={{display:'grid',gridTemplateColumns:'1fr 1fr',gap:12}}>
        <label><div className="muted">Portions</div><input type="number" min="1" value={form.portions} onChange={e=>set('portions',e.target.value)}/></label>
        <label style={{display:'flex',alignItems:'center',gap:8,paddingTop:20}}><input type="checkbox" checked={form.active} onChange={e=>set('active',e.target.checked)} style={{width:'auto'}}/><span className="muted">Active on menu</span></label>
      </div>
      <label><div className="muted">Recipe Reference (optional)</div>
        <select value={form.recipe_id||''} onChange={e=>set('recipe_id',e.target.value||'')} style={{background:'rgba(255,255,255,.065)',border:'1px solid rgba(255,255,255,.1)',color:'white',borderRadius:12,padding:'11px 13px',width:'100%'}}>
          <option value="">— no recipe —</option>{recipes.map(r=><option key={r.id} value={r.id}>{r.name}</option>)}
        </select>
      </label>
      <div style={{display:'flex',justifyContent:'space-between',alignItems:'center',marginTop:4}}>
        <div style={{fontWeight:900,fontSize:13}}>Ingredients</div>
        <button onClick={addIngRow} style={{padding:'5px 10px',fontSize:12}}>+ Add</button>
      </div>
      {ingRows.length===0 && <p className="muted" style={{fontSize:12,margin:'4px 0'}}>No ingredients assigned.</p>}
      {ingRows.map((row,i)=>{
        const ing=ingredients.find(ig=>ig.id===Number(row.ingredient_id));
        const spp=ing?(Number(ing.servings_per_purchase)||1):1;
        const lc=ing?((Number(ing.cost)/spp)*(Number(row.quantity)||0)):0;
        return <div key={i} style={{display:'grid',gridTemplateColumns:'1fr 70px 70px 50px 28px',gap:8,alignItems:'center',marginBottom:6}}>
          <select value={row.ingredient_id} onChange={e=>{ updateIng(i,'ingredient_id',e.target.value); const ig=ingredients.find(x=>x.id===Number(e.target.value)); if(ig) updateIng(i,'unit',ig.unit); }} style={selectStyle}>
            <option value="">Select ingredient…</option>
            {ingredients.map(ig=><option key={ig.id} value={ig.id}>{ig.name} ({ig.unit})</option>)}
          </select>
          <input type="number" step="0.01" min="0.01" value={row.quantity} onChange={e=>updateIng(i,'quantity',e.target.value)} style={{borderRadius:10,background:'rgba(255,255,255,.065)',border:'1px solid rgba(255,255,255,.1)',color:'white',padding:'8px'}}/>
          <input value={row.unit||ing?.unit||''} onChange={e=>updateIng(i,'unit',e.target.value)} placeholder="unit" style={{borderRadius:10,background:'rgba(255,255,255,.065)',border:'1px solid rgba(255,255,255,.1)',color:'white',padding:'8px'}}/>
          <div style={{fontSize:11,color:'#fca5a5',textAlign:'right'}}>{lc>0?`$${lc.toFixed(2)}`:''}</div>
          <button onClick={()=>removeIng(i)} style={{padding:'4px 8px',background:'rgba(239,68,68,.3)'}}>×</button>
        </div>;
      })}
      {ingRows.length>0 && <div className="muted" style={{fontSize:12,textAlign:'right',marginBottom:4}}>Ingredient subtotal: <strong style={{color:'#fca5a5'}}>${ingSubtotal.toFixed(4)}</strong></div>}

      <div style={{display:'flex',justifyContent:'space-between',alignItems:'center',marginTop:4}}>
        <div style={{fontWeight:900,fontSize:13}}>Compound Ingredients</div>
        <button onClick={addCompRow} style={{padding:'5px 10px',fontSize:12}}>+ Add</button>
      </div>
      {compRows.length===0 && <p className="muted" style={{fontSize:12,margin:'4px 0'}}>No compound ingredients assigned.</p>}
      {compRows.map((row,i)=>{
        const ci=allCompounds.find(c=>c.id===Number(row.compound_ingredient_id));
        const cpu=compCosts[Number(row.compound_ingredient_id)];
        const lc=(cpu&&cpu!=='loading')?(Number(cpu)*(Number(row.quantity)||0)):null;
        return <div key={i} style={{display:'grid',gridTemplateColumns:'1fr 70px 70px 70px 28px',gap:8,alignItems:'center',marginBottom:6}}>
          <select value={row.compound_ingredient_id} onChange={e=>{ updateComp(i,'compound_ingredient_id',e.target.value); const c=allCompounds.find(x=>x.id===Number(e.target.value)); if(c) updateComp(i,'unit',c.yield_unit); }} style={selectStyle}>
            <option value="">Select compound…</option>
            {allCompounds.map(c=><option key={c.id} value={c.id}>{c.name} ({c.yield_unit})</option>)}
          </select>
          <input type="number" step="0.01" min="0.01" value={row.quantity} onChange={e=>updateComp(i,'quantity',e.target.value)} style={{borderRadius:10,background:'rgba(255,255,255,.065)',border:'1px solid rgba(255,255,255,.1)',color:'white',padding:'8px'}}/>
          <input value={row.unit||ci?.yield_unit||''} onChange={e=>updateComp(i,'unit',e.target.value)} placeholder="unit" style={{borderRadius:10,background:'rgba(255,255,255,.065)',border:'1px solid rgba(255,255,255,.1)',color:'white',padding:'8px'}}/>
          <div style={{fontSize:11,color:'#fca5a5',textAlign:'right'}}>{cpu==='loading'?'…':lc!==null?`$${lc.toFixed(2)}`:''}</div>
          <button onClick={()=>removeComp(i)} style={{padding:'4px 8px',background:'rgba(239,68,68,.3)'}}>×</button>
        </div>;
      })}
      {compRows.length>0 && <div className="muted" style={{fontSize:12,textAlign:'right',marginBottom:4}}>Compound subtotal: <strong style={{color:'#fca5a5'}}>${compSubtotal.toFixed(4)}</strong></div>}

      {(ingRows.length>0||compRows.length>0) && <div style={{background:'rgba(255,255,255,.04)',borderRadius:10,padding:'10px 14px',marginBottom:8,fontSize:13}}>
        <div style={{display:'flex',justifyContent:'space-between'}}><span className="muted">Ingredient subtotal</span><span>${ingSubtotal.toFixed(4)}</span></div>
        <div style={{display:'flex',justifyContent:'space-between'}}><span className="muted">Compound subtotal</span><span>${compSubtotal.toFixed(4)}</span></div>
        <div style={{display:'flex',justifyContent:'space-between',fontWeight:900,borderTop:'1px solid rgba(255,255,255,.1)',marginTop:6,paddingTop:6}}><span>Est. food cost</span><span style={{color:'#fca5a5'}}>${totalCost.toFixed(4)}</span></div>
        {margin!==null && <div style={{display:'flex',justifyContent:'space-between',marginTop:4}}><span className="muted">Est. margin</span><span style={{color:margin>=50?'#86efac':margin>=30?'#fde68a':'#fca5a5'}}>{margin.toFixed(1)}%</span></div>}
      </div>}

      <label><div className="muted">Description</div><textarea value={form.description} onChange={e=>set('description',e.target.value)}/></label>
      <label><div className="muted">Prep Notes</div><textarea value={form.prep_notes} onChange={e=>set('prep_notes',e.target.value)}/></label>
      {saveError && <div className="badge red" style={{borderRadius:10,padding:'8px 12px'}}>{saveError}</div>}
      <button className="primary" onClick={save} disabled={saving}>{saving?'Saving…':'Save Item'}</button>
    </div>
  </div></div>;
}

// ── Events ─────────────────────────────────────────────────────────────────────
function EventsPage({events,menuItems,api,refresh,setModal,remove}){
  return <><div className="card" style={{marginBottom:18,display:'flex',justifyContent:'space-between',alignItems:'center'}}><div><h3>Events</h3><p className="muted">{events.length} records</p></div><button className="primary" onClick={()=>setModal({collection:'events',item:{}})}>Add</button></div><div className="grid cards">{events.map(ev=><EventCard key={ev.id} event={ev} menuItems={menuItems} api={api} refresh={refresh} setModal={setModal} remove={remove}/>)}</div></>;
}
function EventCard({event,menuItems,api,refresh,setModal,remove}){
  const [profitOpen,setProfitOpen]=useState(false);const [profit,setProfit]=useState(null);const [profitLoading,setProfitLoading]=useState(false);const [saleOpen,setSaleOpen]=useState(false);
  async function loadProfit(){ if(profitOpen){setProfitOpen(false);return;} setProfitLoading(true); try{setProfit(await api(`/api/events/${event.id}/profit`));setProfitOpen(true);}catch(e){alert('Failed: '+e.message);}finally{setProfitLoading(false);} }
  async function afterSale(){ if(profitOpen) setProfit(await api(`/api/events/${event.id}/profit`)); await refresh(); }
  const sc={Confirmed:'green',Completed:'',Interested:'yellow',Applied:'yellow',Rejected:'red'}[event.status]||'yellow';
  return <div className="card event-card">
    <div style={{display:'flex',justifyContent:'space-between',alignItems:'flex-start',gap:8}}><div><h3 style={{margin:'0 0 4px'}}>{event.name}</h3><p className="muted" style={{margin:0}}>{String(event.date||'').slice(0,10)} · {event.location}</p><p className="muted" style={{margin:'4px 0 0'}}>{event.status} · Expected {money(event.expected_sales)}</p></div><Badge color={sc}>{event.status}</Badge></div>
    {event.notes&&<p className="muted" style={{margin:'10px 0 0',fontSize:12}}>{event.notes}</p>}
    <div className="actions" style={{marginTop:14,flexWrap:'wrap'}}>
      <button onClick={loadProfit} disabled={profitLoading}>{profitLoading?'Loading…':profitOpen?'Hide Profit':'View Profit'}</button>
      <button className="primary" onClick={()=>setSaleOpen(true)}>Add Sale</button>
      <button onClick={()=>setModal({collection:'events',item:event})}>Edit</button>
      <button onClick={()=>remove('events',event.id)}>Delete</button>
    </div>
    {profitOpen&&profit&&<ProfitPanel profit={profit}/>}
    {saleOpen&&<SaleModal event={event} menuItems={menuItems} api={api} onClose={()=>setSaleOpen(false)} onSaved={afterSale}/>}
  </div>;
}
function ProfitPanel({profit}){const p=profit;return <div className="profit-panel"><div className="profit-grid"><ProfitStat label="Gross Sales" value={money(p.gross_sales)}/><ProfitStat label="Units Sold" value={p.units_sold}/><ProfitStat label="Food Cost" value={money(p.food_cost)} note={p.food_cost_source}/><ProfitStat label="Event Expenses" value={money(p.event_expenses)}/><ProfitStat label="Gross Profit" value={money(p.gross_profit)} color={p.gross_profit>=0?'green':'red'}/><ProfitStat label="Net Profit" value={money(p.net_profit)} color={p.net_profit>=0?'green':'red'}/><ProfitStat label="Gross Margin" value={pct(p.gross_margin_percent)}/><ProfitStat label="vs Expected" value={money(p.vs_expected)} color={p.vs_expected>=0?'green':'red'}/></div>{p.sales_breakdown.length>0&&<>{<div className="muted" style={{fontSize:11,marginTop:12,marginBottom:6,textTransform:'uppercase',letterSpacing:'0.1em'}}>Sales breakdown</div>}{p.sales_breakdown.map((row,i)=><div key={i} className="profit-row"><span>{row.item}</span><span className="muted">×{row.qty}</span><span>{money(row.revenue)}</span></div>)}</>}{p.expense_items?.length>0&&<>{<div className="muted" style={{fontSize:11,marginTop:10,marginBottom:6,textTransform:'uppercase',letterSpacing:'0.1em'}}>Expenses</div>}{p.expense_items.map((ex,i)=><div key={i} className="profit-row"><span>{ex.title}</span><span className="muted">{ex.category}</span><span style={{color:'#fca5a5'}}>{money(ex.amount)}</span></div>)}</>}</div>;}
function ProfitStat({label,value,note,color}){return <div className="profit-stat"><div className="muted" style={{fontSize:11}}>{label}{note&&<span style={{marginLeft:4,fontSize:10,opacity:.7}}>({note})</span>}</div><div style={{fontSize:18,fontWeight:900,color:color==='green'?'#86efac':color==='red'?'#fca5a5':undefined}}>{value}</div></div>;}
function SaleModal({event,menuItems,api,onClose,onSaved}){
  const [menuItemId,setMenuItemId]=useState(menuItems[0]?.id||'');const [quantity,setQuantity]=useState(1);const [note,setNote]=useState('');const [saving,setSaving]=useState(false);const [result,setResult]=useState(null);const [error,setError]=useState('');
  async function submit(e){e.preventDefault();if(!menuItemId||quantity<1){setError('Select item and quantity.');return;}setSaving(true);setError('');setResult(null);try{const data=await api('/api/sales-orders',{method:'POST',body:JSON.stringify({event_id:event.id,menu_item_id:Number(menuItemId),quantity:Number(quantity),note:note||null})});setResult(data);await onSaved();}catch(e){setError(e.message);}finally{setSaving(false);}}
  const sel=menuItems.find(m=>m.id===Number(menuItemId));
  return <div className="modal"><div className="modal-card" style={{width:'min(520px,100%)'}}>
    <div style={{display:'flex',justifyContent:'space-between',alignItems:'center',marginBottom:16}}><h3 style={{margin:0}}>Add Sale — {event.name}</h3><button onClick={onClose}>×</button></div>
    {!result&&<form className="form" onSubmit={submit}><label><div className="muted">Menu Item</div><select value={menuItemId} onChange={e=>setMenuItemId(e.target.value)} style={{background:'rgba(255,255,255,.065)',border:'1px solid rgba(255,255,255,.1)',color:'white',borderRadius:12,padding:'11px 13px',width:'100%'}}>{menuItems.map(m=><option key={m.id} value={m.id}>{m.name} — {money(m.price)}</option>)}</select></label><label><div className="muted">Quantity</div><input type="number" min="1" value={quantity} onChange={e=>setQuantity(e.target.value)}/></label><label><div className="muted">Note</div><input value={note} onChange={e=>setNote(e.target.value)} placeholder="comp, event special…"/></label>{sel&&<div className="muted" style={{fontSize:12}}>Est. revenue: {money(Number(sel.price)*Number(quantity||0))}</div>}{error&&<div className="badge red">{error}</div>}<div style={{display:'flex',gap:10}}><button className="primary" type="submit" disabled={saving}>{saving?'Saving…':'Record Sale'}</button><button type="button" onClick={onClose}>Cancel</button></div></form>}
    {result&&<SaleResult result={result} onClose={onClose} onAnother={()=>setResult(null)}/>}
  </div></div>;
}
function SaleResult({result,onClose,onAnother}){const {order,consumption}=result;const deductions=consumption?.deductions||[];const unmapped=consumption?.unmapped_ingredients||[];return <div className="form"><div className="badge green" style={{fontSize:14,borderRadius:12,padding:'8px 14px'}}>✓ Sale recorded</div><div className="profit-panel" style={{marginTop:4}}><div className="profit-row"><span>Order ID</span><span>#{order.id}</span></div><div className="profit-row"><span>Quantity</span><span>{order.quantity}</span></div>{order.note&&<div className="profit-row"><span>Note</span><span>{order.note}</span></div>}</div>{deductions.length>0&&<><div className="muted" style={{fontSize:11,textTransform:'uppercase',letterSpacing:'0.1em',marginTop:8}}>Inventory deducted</div>{deductions.map((d,i)=><div key={i} className="profit-row"><span>{d.inventory_item}</span><span style={{color:'#fca5a5'}}>−{d.deducted} {d.unit}</span></div>)}</>}{unmapped.length>0&&<><div className="muted" style={{fontSize:11,textTransform:'uppercase',letterSpacing:'0.1em',marginTop:8}}>Warnings</div>{unmapped.map((w,i)=><div key={i} className="badge yellow" style={{borderRadius:10,margin:'2px 0'}}>Unmapped: {w}</div>)}</>}<div style={{display:'flex',gap:10,marginTop:4}}><button className="primary" onClick={onAnother}>Add Another</button><button onClick={onClose}>Done</button></div></div>;}

// ── Generic Collection ─────────────────────────────────────────────────────────
function labelFor(page,item){return item.name||item.title||item.client||item.id;}
function descFor(page,item){if(page==='catering') return `${item.status} · ${String(item.date||'').slice(0,10)} · $${Number(item.value||0).toLocaleString()} · ${item.location||''}`; if(page==='staff') return `${item.role} · ${item.status} · ${item.hours||0} hours`; if(page==='equipment') return `${item.status} · ${item.location||''}`; return item.category||item.status||item.notes||'';}
function Collection({page,data,setModal,remove}){return <><div className="card" style={{marginBottom:18,display:'flex',justifyContent:'space-between',gap:12,alignItems:'center'}}><div><h3>{page}</h3><p className="muted">{data.length} records</p></div>{fields[page]&&<button className="primary" onClick={()=>setModal({collection:page,item:{}})}>Add</button>}</div><div className="grid cards">{data.map(item=><div className="card" key={item.id}><h3>{labelFor(page,item)}</h3><p className="muted">{descFor(page,item)}</p><p className="muted">{item.description||item.notes||item.content||''}</p><div className="actions"><button onClick={()=>setModal({collection:page,item})}>Edit</button><button onClick={()=>remove(page,item.id)}>Delete</button></div></div>)}</div></>;}
function EditModal({modal,save,close}){const [form,setForm]=useState(modal.item||{});const flds=fields[modal.collection]||[];function set(k,v){setForm(x=>({...x,[k]:v}));}return <div className="modal"><div className="modal-card"><div style={{display:'flex',justifyContent:'space-between',alignItems:'center'}}><h3>{modal.item.id?'Edit':'Add'} {modal.collection}</h3><button onClick={close}>×</button></div><div className="form">{flds.map(k=><label key={k}><div className="muted">{k.replaceAll('_',' ')}</div>{['notes','description','content','prep_notes'].includes(k)?<textarea value={form[k]||''} onChange={e=>set(k,e.target.value)}/>:<input value={form[k]??''} onChange={e=>set(k,e.target.value)}/>}</label>)}<button className="primary" onClick={()=>save(modal.collection,form,modal.item.id)}>Save</button></div></div></div>;}

// ── Today ──────────────────────────────────────────────────────────────────────
function Today({overview}){const m=overview.metrics;return <><div className="grid metrics"><Metric label="Inventory Alerts" value={m.inventory_alerts} note="At or below minimum"/><Metric label="Catering Pipeline" value={'$'+Number(m.catering_pipeline||0).toLocaleString(undefined,{maximumFractionDigits:0})} note="Open value"/><Metric label="Open Tasks" value={m.open_tasks} note="Needs action"/><Metric label="Active Staff" value={m.active_staff} note="On/active"/><Metric label="Avg Menu Margin" value={pct(m.avg_menu_margin)} note="Food cost health"/></div><div className="grid two" style={{marginTop:20}}><div className="card"><h3>Operational Timeline</h3><div className="list">{overview.timeline.map((x,i)=><div className="row" key={i}><div><strong>{x.title}</strong><span>{x.kind} · {x.type} · {String(x.time||'Today').slice(0,10)}</span></div><Badge color={x.priority==='High'?'red':'orange'}>{x.status}</Badge></div>)}</div></div><div className="card"><h3>AI Recommendations</h3><div className="list">{overview.insights.length?overview.insights.map((x,i)=><div className="row" key={i}><div><strong>{x.title}</strong><span>{x.detail}<br/>{x.action}</span></div><Badge color={x.level==='Critical'?'red':x.level==='Warning'?'yellow':'green'}>{x.level}</Badge></div>):<p className="muted">No major risks.</p>}</div></div></div></>;}
function AiPage({aiPrompt,setAiPrompt,aiAnswer,setAiAnswer,api}){async function ask(){setAiAnswer('Thinking…');const r=await api('/api/ai/ask',{method:'POST',body:JSON.stringify({prompt:aiPrompt})});setAiAnswer(r.text);}return <div className="grid two"><div className="card"><h3>AI Copilot</h3><p className="muted">Rules-based until AI_ENABLED=true.</p><div className="form"><textarea value={aiPrompt} onChange={e=>setAiPrompt(e.target.value)}/><button className="primary" onClick={ask}>Ask AI</button></div></div><div className="card"><h3>Answer</h3><pre style={{whiteSpace:'pre-wrap'}}>{aiAnswer||'Ask a question about operations.'}</pre></div></div>;}

createRoot(document.getElementById('root')).render(<App/>);
