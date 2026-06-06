import React, { useEffect, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { Boxes, CalendarDays, ChefHat, ClipboardList, Home, Users, Wrench, Truck, Brain, ShieldCheck, LogOut } from 'lucide-react';
import './style.css';

const nav = [
  ['today', Home, 'Operations Today'],
  ['inventory', Boxes, 'Inventory'],
  ['menu', ChefHat, 'Menu'],
  ['catering', ClipboardList, 'Catering'],
  ['events', CalendarDays, 'Events'],
  ['staff', Users, 'Staff'],
  ['equipment', Wrench, 'Assets'],
  ['suppliers', Truck, 'Suppliers'],
  ['tasks', ShieldCheck, 'Tasks'],
  ['playbook', Brain, 'Playbook'],
  ['ai', Brain, 'AI Copilot']
];

const fields = {
  inventory:['name','category','unit','current_stock','min_stock','max_stock','cost','supplier','forecast_per_event'],
  menu:['name','category','price','cost','active','description','prep_notes'],
  catering:['client','date','guests','status','value','deposit','location','service_type','notes','readiness'],
  events:['name','date','location','status','expected_sales','notes'],
  staff:['name','role','status','hours','food_card_expiry','phone','notes'],
  equipment:['name','status','location','qr_code','quantity_total','quantity_available','notes'],
  suppliers:['name','category','phone','email','notes'],
  tasks:['title','category','status','priority','due_time','notes'],
  playbook:['title','category','content']
};

const money = n => '$' + Number(n||0).toLocaleString(undefined,{minimumFractionDigits:2,maximumFractionDigits:2});
const pct = n => Number(n||0).toFixed(1)+'%';
function margin(p,c){p=Number(p||0);c=Number(c||0);return p?((p-c)/p)*100:0;}

function useApi() {
  const [token, setToken] = useState(localStorage.getItem('bf_token') || '');
  const [user, setUser] = useState(JSON.parse(localStorage.getItem('bf_user') || 'null'));

  async function api(path, opts={}) {
    const res = await fetch(path, {
      ...opts,
      headers: {
        'Content-Type':'application/json',
        ...(opts.headers||{}),
        ...(token ? {Authorization:`Bearer ${token}`} : {})
      }
    });
    if(!res.ok) throw new Error(await res.text());
    return res.json();
  }

  async function login(username,password) {
    const res = await fetch('/api/auth/login', {method:'POST', headers:{'Content-Type':'application/json'}, body:JSON.stringify({username,password})});
    if(!res.ok) throw new Error(await res.text());
    const data = await res.json();
    localStorage.setItem('bf_token', data.token);
    localStorage.setItem('bf_user', JSON.stringify(data.user));
    setToken(data.token); setUser(data.user);
  }

  function logout(){localStorage.removeItem('bf_token'); localStorage.removeItem('bf_user'); setToken(''); setUser(null);}
  return {token,user,api,login,logout};
}

function Login({login}) {
  const [error,setError]=useState('');
  async function submit(e){
    e.preventDefault();
    setError('');
    const f=new FormData(e.currentTarget);
    try { await login(f.get('username'), f.get('password')); } catch { setError('Login failed. Use admin/admin123 unless changed.'); }
  }
  return <div className="login"><form className="card form" onSubmit={submit}>
    <div className="brand"><div className="logo">BF</div><div><h1>Birria Fusion</h1><p>Operations Intelligence</p></div></div>
    <input name="username" defaultValue="admin" placeholder="Username" />
    <input name="password" defaultValue="admin123" type="password" placeholder="Password" />
    {error && <div className="badge red">{error}</div>}
    <button className="primary">Login</button>
  </form></div>;
}

function Metric({label,value,note}){return <div className="card"><div className="metric-label">{label}</div><div className="metric-value">{value}</div><div className="muted">{note}</div></div>;}
function Badge({children, color=''}){return <span className={`badge ${color}`}>{children}</span>;}

function App(){
  const auth=useApi();
  const [page,setPage]=useState('today');
  const [overview,setOverview]=useState(null);
  const [modal,setModal]=useState(null);
  const [aiPrompt,setAiPrompt]=useState('What needs attention today?');
  const [aiAnswer,setAiAnswer]=useState('');

  async function refresh(){
    try { setOverview(await auth.api('/api/overview')); }
    catch(err) {
      if(err.message.includes('401') || err.message.includes('Missing auth') || err.message.includes('Invalid auth') || err.message.includes('500') || err.message.includes('Failed')) {
        auth.logout();
      } else {
        console.error(err);
        auth.logout();
      }
    }
  }
  useEffect(()=>{ if(auth.token) refresh(); },[auth.token]);

  if(!auth.token) return <Login login={auth.login}/>;
  if(!overview) return <div className="login"><div className="card">Loading...</div></div>;

  const title = nav.find(x=>x[0]===page)?.[2] || 'TruckFlow Ops';
  const VERSION = 'v0.1.2';
  const data = overview.data[page] || [];

  async function save(collection, item, id){
    await auth.api(`/api/${collection}${id?`/${id}`:''}`, {method:id?'PUT':'POST', body:JSON.stringify(item)});
    setModal(null); await refresh();
  }

  async function remove(collection,id){
    if(!confirm('Delete this item?')) return;
    await auth.api(`/api/${collection}/${id}`, {method:'DELETE'});
    await refresh();
  }

  async function askAi(){
    setAiAnswer('Thinking...');
    const res = await auth.api('/api/ai/ask', {method:'POST', body:JSON.stringify({prompt:aiPrompt})});
    setAiAnswer(res.text);
  }

  return <div className="app">
    <aside className="sidebar">
      <div className="brand"><div className="logo">BF</div><div><h1>Birria Fusion</h1><p>Operations Intelligence</p></div></div>
      {nav.map(([id,Icon,label])=><button key={id} onClick={()=>setPage(id)} className={`navbtn ${page===id?'active':''}`}><Icon size={18}/>{label}</button>)}
    </aside>

    <main className="main">
      <header className="topbar">
        <div><div className="kicker">Command Center · {auth.user?.role} · {VERSION}</div><h2>{title}</h2></div>
        <div className="actions"><button onClick={()=>setPage('ai')}>AI</button><button onClick={auth.logout}><LogOut size={16}/> Logout</button></div>
      </header>

      <section className="content">
        {page==='today' && <Today overview={overview}/>}
        {page==='ai' && <div className="grid two">
          <div className="card"><h3>AI Copilot</h3><p className="muted">Rules-based until AI_ENABLED=true and Ollama is reachable.</p><div className="form"><textarea value={aiPrompt} onChange={e=>setAiPrompt(e.target.value)}/><button className="primary" onClick={askAi}>Ask AI</button></div></div>
          <div className="card"><h3>Answer</h3><pre style={{whiteSpace:'pre-wrap'}}>{aiAnswer || 'Ask a question about operations.'}</pre></div>
        </div>}
        {page==='events' && <EventsPage events={data} menuItems={overview.data.menu||[]} api={auth.api} refresh={refresh} setModal={setModal} remove={remove}/>}
        {page!=='today' && page!=='ai' && page!=='events' && <Collection page={page} data={data} setModal={setModal} remove={remove}/>}
      </section>
    </main>

    {modal && <EditModal modal={modal} save={save} close={()=>setModal(null)}/>}
  </div>;
}

// ── Events Page ────────────────────────────────────────────────────────────────

function EventsPage({events, menuItems, api, refresh, setModal, remove}) {
  return <>
    <div className="card" style={{marginBottom:18,display:'flex',justifyContent:'space-between',gap:12,alignItems:'center'}}>
      <div><h3>events</h3><p className="muted">{events.length} records</p></div>
      <button className="primary" onClick={()=>setModal({collection:'events',item:{}})}>Add</button>
    </div>
    <div className="grid cards">
      {events.map(ev=><EventCard key={ev.id} event={ev} menuItems={menuItems} api={api} refresh={refresh} setModal={setModal} remove={remove}/>)}
    </div>
  </>;
}

function EventCard({event, menuItems, api, refresh, setModal, remove}) {
  const [profitOpen, setProfitOpen] = useState(false);
  const [profit, setProfit] = useState(null);
  const [profitLoading, setProfitLoading] = useState(false);
  const [saleOpen, setSaleOpen] = useState(false);

  async function loadProfit() {
    if(profitOpen) { setProfitOpen(false); return; }
    setProfitLoading(true);
    try {
      const data = await api(`/api/events/${event.id}/profit`);
      setProfit(data);
      setProfitOpen(true);
    } catch(e) {
      alert('Failed to load profit: ' + e.message);
    } finally {
      setProfitLoading(false);
    }
  }

  async function afterSale() {
    // Refresh profit panel if open, and refresh overview
    if(profitOpen) {
      const data = await api(`/api/events/${event.id}/profit`);
      setProfit(data);
    }
    await refresh();
  }

  return <div className="card event-card">
    <div style={{display:'flex',justifyContent:'space-between',alignItems:'flex-start',gap:8}}>
      <div>
        <h3 style={{margin:'0 0 4px'}}>{event.name}</h3>
        <p className="muted" style={{margin:0}}>{String(event.date||'').slice(0,10)} · {event.location}</p>
        <p className="muted" style={{margin:'4px 0 0'}}>{event.status} · Expected {money(event.expected_sales)}</p>
      </div>
      <Badge color={event.status==='Confirmed'?'green':event.status==='Completed'?'':'yellow'}>{event.status}</Badge>
    </div>

    {event.notes && <p className="muted" style={{margin:'10px 0 0',fontSize:12}}>{event.notes}</p>}

    <div className="actions" style={{marginTop:14,flexWrap:'wrap'}}>
      <button onClick={loadProfit} disabled={profitLoading}>
        {profitLoading ? 'Loading…' : profitOpen ? 'Hide Profit' : 'View Profit'}
      </button>
      <button className="primary" onClick={()=>setSaleOpen(true)}>Add Sale</button>
      <button onClick={()=>setModal({collection:'events',item:event})}>Edit</button>
      <button onClick={()=>remove('events',event.id)}>Delete</button>
    </div>

    {profitOpen && profit && <ProfitPanel profit={profit}/>}
    {saleOpen && <SaleModal event={event} menuItems={menuItems} api={api} onClose={()=>setSaleOpen(false)} onSaved={afterSale}/>}
  </div>;
}

function ProfitPanel({profit}) {
  const p = profit;
  return <div className="profit-panel">
    <div className="profit-grid">
      <ProfitStat label="Gross Sales"     value={money(p.gross_sales)}            />
      <ProfitStat label="Units Sold"      value={p.units_sold}                     />
      <ProfitStat label="Food Cost"       value={money(p.food_cost)} note={p.food_cost_source} />
      <ProfitStat label="Event Expenses"  value={money(p.event_expenses)}          />
      <ProfitStat label="Gross Profit"    value={money(p.gross_profit)}  color={p.gross_profit>=0?'green':'red'} />
      <ProfitStat label="Net Profit"      value={money(p.net_profit)}    color={p.net_profit>=0?'green':'red'}   />
      <ProfitStat label="Gross Margin"    value={pct(p.gross_margin_percent)}      />
      <ProfitStat label="vs Expected"     value={money(p.vs_expected)}   color={p.vs_expected>=0?'green':'red'}  />
    </div>

    {p.sales_breakdown.length > 0 && <>
      <div className="muted" style={{fontSize:11,marginTop:12,marginBottom:6,textTransform:'uppercase',letterSpacing:'0.1em'}}>Sales breakdown</div>
      {p.sales_breakdown.map((row,i)=><div key={i} className="profit-row">
        <span>{row.item}</span>
        <span className="muted">×{row.qty}</span>
        <span>{money(row.revenue)}</span>
      </div>)}
    </>}

    {p.expense_items && p.expense_items.length > 0 && <>
      <div className="muted" style={{fontSize:11,marginTop:10,marginBottom:6,textTransform:'uppercase',letterSpacing:'0.1em'}}>Expenses</div>
      {p.expense_items.map((ex,i)=><div key={i} className="profit-row">
        <span>{ex.title}</span>
        <span className="muted">{ex.category}</span>
        <span style={{color:'#fca5a5'}}>{money(ex.amount)}</span>
      </div>)}
    </>}
  </div>;
}

function ProfitStat({label,value,note,color}) {
  return <div className="profit-stat">
    <div className="muted" style={{fontSize:11}}>{label}{note && <span style={{marginLeft:4,fontSize:10,opacity:.7}}>({note})</span>}</div>
    <div style={{fontSize:18,fontWeight:900,color: color==='green'?'#86efac':color==='red'?'#fca5a5':undefined}}>{value}</div>
  </div>;
}

// ── Sale Modal ─────────────────────────────────────────────────────────────────

function SaleModal({event, menuItems, api, onClose, onSaved}) {
  const [menuItemId, setMenuItemId] = useState(menuItems[0]?.id || '');
  const [quantity, setQuantity] = useState(1);
  const [note, setNote] = useState('');
  const [saving, setSaving] = useState(false);
  const [result, setResult] = useState(null);
  const [error, setError] = useState('');

  async function submit(e) {
    e.preventDefault();
    if(!menuItemId || !quantity || quantity < 1) { setError('Select an item and enter a valid quantity.'); return; }
    setSaving(true); setError(''); setResult(null);
    try {
      const data = await api('/api/sales-orders', {
        method: 'POST',
        body: JSON.stringify({ event_id: event.id, menu_item_id: Number(menuItemId), quantity: Number(quantity), note: note || null })
      });
      setResult(data);
      await onSaved();
    } catch(e) {
      setError(e.message);
    } finally {
      setSaving(false);
    }
  }

  const selectedItem = menuItems.find(m=>m.id===Number(menuItemId));

  return <div className="modal">
    <div className="modal-card" style={{width:'min(520px,100%)'}}>
      <div style={{display:'flex',justifyContent:'space-between',alignItems:'center',marginBottom:16}}>
        <h3 style={{margin:0}}>Add Sale — {event.name}</h3>
        <button onClick={onClose}>×</button>
      </div>

      {!result && <form className="form" onSubmit={submit}>
        <label>
          <div className="muted">Menu Item</div>
          <select value={menuItemId} onChange={e=>setMenuItemId(e.target.value)} style={{background:'rgba(255,255,255,.065)',border:'1px solid rgba(255,255,255,.1)',color:'white',borderRadius:12,padding:'11px 13px',width:'100%',fontSize:'inherit'}}>
            {menuItems.map(m=><option key={m.id} value={m.id}>{m.name} — {money(m.price)}</option>)}
          </select>
        </label>
        <label>
          <div className="muted">Quantity</div>
          <input type="number" min="1" value={quantity} onChange={e=>setQuantity(e.target.value)}/>
        </label>
        <label>
          <div className="muted">Note (optional)</div>
          <input value={note} onChange={e=>setNote(e.target.value)} placeholder="e.g. comp, event special"/>
        </label>
        {selectedItem && <div className="muted" style={{fontSize:12}}>
          Est. revenue: {money(Number(selectedItem.price)*Number(quantity||0))} · Est. cost: {money(Number(selectedItem.cost)*Number(quantity||0))}
        </div>}
        {error && <div className="badge red">{error}</div>}
        <div style={{display:'flex',gap:10}}>
          <button className="primary" type="submit" disabled={saving}>{saving?'Saving…':'Record Sale'}</button>
          <button type="button" onClick={onClose}>Cancel</button>
        </div>
      </form>}

      {result && <SaleResult result={result} onClose={onClose} onAnother={()=>setResult(null)}/>}
    </div>
  </div>;
}

function SaleResult({result, onClose, onAnother}) {
  const { order, consumption } = result;
  const deductions = consumption?.deductions || [];
  const unmapped = consumption?.unmapped_ingredients || [];
  const warnings = unmapped.map(n => `Unmapped: ${n} — no inventory deducted`);
  const hasConsumption = deductions.length > 0;

  return <div className="form">
    <div className="badge green" style={{fontSize:14,borderRadius:12,padding:'8px 14px'}}>✓ Sale recorded</div>

    <div className="profit-panel" style={{marginTop:4}}>
      <div className="profit-row"><span>Order ID</span><span>#{order.id}</span></div>
      <div className="profit-row"><span>Quantity</span><span>{order.quantity}</span></div>
      <div className="profit-row"><span>Event</span><span>Event #{order.event_id}</span></div>
      {order.note && <div className="profit-row"><span>Note</span><span>{order.note}</span></div>}
    </div>

    {hasConsumption && <>
      <div className="muted" style={{fontSize:11,textTransform:'uppercase',letterSpacing:'0.1em',marginTop:8}}>Inventory deducted</div>
      {deductions.map((d,i)=><div key={i} className="profit-row">
        <span>{d.inventory_item}</span>
        <span style={{color:'#fca5a5'}}>−{d.deducted} {d.unit}</span>
      </div>)}
    </>}

    {warnings.length > 0 && <>
      <div className="muted" style={{fontSize:11,textTransform:'uppercase',letterSpacing:'0.1em',marginTop:8}}>Warnings</div>
      {warnings.map((w,i)=><div key={i} className="badge yellow" style={{borderRadius:10,margin:'2px 0'}}>{w}</div>)}
    </>}

    {!hasConsumption && !warnings.length && <div className="muted" style={{fontSize:12}}>No inventory mappings found — consumption skipped.</div>}

    <div style={{display:'flex',gap:10,marginTop:4}}>
      <button className="primary" onClick={onAnother}>Add Another</button>
      <button onClick={onClose}>Done</button>
    </div>
  </div>;
}

function Today({overview}){
  const m=overview.metrics;
  return <>
    <div className="grid metrics">
      <Metric label="Inventory Alerts" value={m.inventory_alerts} note="At or below minimum"/>
      <Metric label="Catering Pipeline" value={money(m.catering_pipeline)} note="Open value"/>
      <Metric label="Open Tasks" value={m.open_tasks} note="Needs action"/>
      <Metric label="Active Staff" value={m.active_staff} note="On/active"/>
      <Metric label="Avg Menu Margin" value={pct(m.avg_menu_margin)} note="Food cost health"/>
    </div>
    <div className="grid two" style={{marginTop:20}}>
      <div className="card"><h3>Operational Timeline</h3><div className="list">{overview.timeline.map((x,i)=><div className="row" key={i}><div><strong>{x.title}</strong><span>{x.kind} · {x.type} · {String(x.time||'Today').slice(0,10)}</span></div><Badge color={x.priority==='High'?'red':'orange'}>{x.status}</Badge></div>)}</div></div>
      <div className="card"><h3>AI-Style Recommendations</h3><div className="list">
{overview.insights.length?overview.insights.map((x,i)=><div className="row" key={i}><div><strong>{x.title}</strong><span>{x.detail}<br/>{x.action}</span></div><Badge color={x.level==='Critical'?'red':x.level==='Warning'?'yellow':'green'}>{x.level}</Badge></div>):<p className="muted">No major risks.</p>}</div></div>
    </div>
  </>;
}

function labelFor(page,item){return item.name||item.title||item.client||item.id;}
function descFor(page,item){
  if(page==='inventory') return `${item.current_stock} ${item.unit} · min ${item.min_stock} · ${item.supplier||''}`;
  if(page==='menu') return `${item.category} · ${money(item.price)} · margin ${pct(margin(item.price,item.cost))}`;
  if(page==='catering') return `${item.status} · ${String(item.date||'').slice(0,10)} · ${money(item.value)} · ${item.location||''}`;
  if(page==='staff') return `${item.role} · ${item.status} · ${item.hours||0} hours`;
  if(page==='equipment') return `${item.status} · ${item.location||''}`;
  return item.category || item.status || item.notes || '';
}

function Collection({page,data,setModal,remove}){
  return <>
    <div className="card" style={{marginBottom:18,display:'flex',justifyContent:'space-between',gap:12,alignItems:'center'}}>
      <div><h3>{page}</h3><p className="muted">{data.length} records</p></div>
      {fields[page] && <button className="primary" onClick={()=>setModal({collection:page,item:{}})}>Add</button>}
    </div>
    <div className="grid cards">{data.map(item=><div className="card" key={item.id}><h3>{labelFor(page,item)}</h3><p className="muted">{descFor(page,item)}</p><p className="muted">{item.description||item.notes||item.content||''}</p><div className="actions"><button onClick={()=>setModal({collection:page,item})}>Edit</button><button onClick={()=>remove(page,item.id)}>Delete</button></div></div>)}</div>
  </>;
}

function EditModal({modal,save,close}){
  const [form,setForm]=useState(modal.item || {});
  const flds=fields[modal.collection]||[];
  function set(k,v){setForm(x=>({...x,[k]:v}));}
  return <div className="modal"><div className="modal-card">
    <div style={{display:'flex',justifyContent:'space-between',alignItems:'center'}}><h3>{modal.item.id?'Edit':'Add'} {modal.collection}</h3><button onClick={close}>×</button></div>
    <div className="form">{flds.map(k=><label key={k}><div className="muted">{k.replaceAll('_',' ')}</div>{['notes','description','content','prep_notes'].includes(k)?<textarea value={form[k]||''} onChange={e=>set(k,e.target.value)}/>:<input value={form[k]??''} onChange={e=>set(k,e.target.value)}/>}</label>)}<button className="primary" onClick={()=>save(modal.collection,form,modal.item.id)}>Save</button></div>
  </div></div>;
}

createRoot(document.getElementById('root')).render(<App/>);
