'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  BookOpenCheck, CheckCircle2, Command, FlaskConical, History, MessageSquareWarning,
  Pencil, RotateCcw, Save, ShieldCheck, Trash2,
} from 'lucide-react';

const SCOPES = [
  ['general', 'General'], ['communication', 'Customer communication'], ['sales', 'Car & motorcycle sales'],
  ['inventory', 'Inventory lookup'], ['photos', 'Original photographs'], ['pricing', 'Approved pricing'],
  ['shipping', 'Shipping policies'], ['follow_up', 'Customer follow-up'], ['whatsapp', 'WhatsApp replies'],
  ['language', 'Language handling'], ['takeover', 'Human takeover'], ['faq', 'Verified FAQ'],
] as const;
const TABS = [
  ['teach', 'Teach AI', BookOpenCheck], ['corrections', 'Correct AI', MessageSquareWarning],
  ['commands', 'AI Commands', Command], ['history', 'Learning History', History], ['test', 'Test AI', FlaskConical],
] as const;
const when = (value: unknown) => value ? new Date(String(value).replace(' ', 'T')).toLocaleString() : '-';
const correctionVersion = (item: Json) => {
  try { return Math.max(1, Number((typeof item.payload === 'string' ? JSON.parse(item.payload) : item.payload)?.version || 1)); }
  catch { return 1; }
};
const emptyInstruction = { title: '', content: '', scope: 'general', priority: 5 };
const emptyCorrection = {
  conversation_id: '', question: '', ai_reply: '', correction: '', lesson: '', reason: '',
  evidence: '', applies_to: 'global', category: 'process',
};

type Json = Record<string, any>;

export default function AiTrainingCenter() {
  const [tab, setTab] = useState<string>('teach');
  const [data, setData] = useState<Json>({ instructions: [], history: [], corrections: [], conversations: [], vehicles: [], audit: [], policy: null, role: '' });
  const [instruction, setInstruction] = useState<Json>(emptyInstruction);
  const [editing, setEditing] = useState<number | null>(null);
  const [correction, setCorrection] = useState<Json>(emptyCorrection);
  const [editingCorrection, setEditingCorrection] = useState<number | null>(null);
  const [commandType, setCommandType] = useState('update_instruction');
  const [command, setCommand] = useState<Json>({ confirmed: false, priority: 3 });
  const [test, setTest] = useState<Json>({
    question: '', vehicle_id: '', proposed_title: '', proposed_content: '', proposed_scope: 'general',
  });
  const [testResult, setTestResult] = useState<Json | null>(null);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');

  const owner = data.role === 'owner';
  const instructionOptions = useMemo(() =>
    (data.instructions || []).filter((item: Json) => item.status === 'approved' && item.active), [data.instructions]);
  const lessonOptions = useMemo(() =>
    (data.corrections || []).filter((item: Json) => ['approved', 'applied'].includes(item.status)), [data.corrections]);

  const load = useCallback(async () => {
    const response = await fetch('/api/admin/ai-training', { cache: 'no-store' });
    const json = await response.json().catch(() => ({}));
    if (!response.ok) { setMessage(json.error || 'Could not load AI training data'); return; }
    setData(json);
  }, []);

  useEffect(() => { void load(); }, [load]);

  async function call(url: string, method: string, body: Json) {
    setBusy(true); setMessage('');
    const response = await fetch(url, { method, headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
    const json = await response.json().catch(() => ({}));
    setBusy(false);
    if (!response.ok) { setMessage(json.error || 'The request failed'); return null; }
    setMessage(json.message || 'Saved. Active runtime instructions now use the current database version.');
    await load();
    return json;
  }

  async function saveInstruction(approve: boolean) {
    if (approve && !confirm('Activate this instruction for subsequent customer AI replies?')) return;
    const body = { ...instruction, action: 'create_instruction', approve, confirmed: approve };
    const out = await call('/api/admin/ai-training', 'POST', body);
    if (out) { setInstruction(emptyInstruction); setEditing(null); }
  }

  async function updateInstruction(activate: boolean) {
    if (!editing) return;
    if (activate && !confirm('Save this edited instruction and activate it immediately?')) return;
    const out = await call('/api/admin/ai-training', 'PATCH', {
      kind: 'instruction', action: 'edit', id: editing, ...instruction, activate, confirmed: true,
    });
    if (out) { setInstruction(emptyInstruction); setEditing(null); }
  }

  async function instructionAction(id: number, action: string) {
    const labels: Json = {
      approve: 'Activate this instruction?', deactivate: 'Disable this instruction for future AI replies?',
      revert: 'Restore the previous instruction version?', delete: 'Remove this instruction from runtime? Its audit history will be retained.',
    };
    if (!confirm(labels[action] || 'Apply this instruction change?')) return;
    await call('/api/admin/ai-training', 'PATCH', { kind: 'instruction', action, id, confirmed: true });
  }

  async function addCorrection() {
    const out = editingCorrection
      ? await call('/api/admin/ai-training', 'PATCH', { kind: 'correction', action: 'edit', id: editingCorrection, ...correction })
      : await call('/api/admin/ai-training', 'POST', { action: 'create_correction', ...correction });
    if (out) { setCorrection(emptyCorrection); setEditingCorrection(null); }
  }

  async function correctionAction(item: Json, action: string) {
    if (['approve', 'apply', 'undo', 'disable', 'delete'].includes(action) && !confirm(`Apply “${action}” to this correction?`)) return;
    await call('/api/admin/ai-training', 'PATCH', {
      kind: 'correction', id: item.id, action, lesson: item.lesson, applies_to: item.applies_to,
      category: item.category, confidence: item.confidence, expires_at: item.expires_at,
    });
  }

  async function runCommand() {
    if (!owner) return;
    if (!command.confirmed) { setMessage('Tick the confirmation box before running an operational command.'); return; }
    if (!confirm('Run this operational command now? This may change live AI or staff workflows.')) return;
    const payload: Json = { action: 'command', command: commandType, ...command };
    if (commandType === 'set_response_style') {
      payload.style = {
        max_sentences: Number(command.max_sentences || 3),
        team_voice: command.team_voice !== false,
        price_first: command.price_first !== false,
        one_question: command.one_question !== false,
        no_internal_terms: true,
      };
    }
    if (commandType === 'update_instruction' && command.instruction_id) {
      const selected = (data.instructions || []).find((x: Json) => Number(x.id) === Number(command.instruction_id));
      Object.assign(payload, {
        title: command.title || selected?.title, content: command.content || selected?.content,
        scope: command.scope || selected?.scope, priority: command.priority || selected?.priority,
      });
    }
    const out = await call('/api/admin/ai-training', 'POST', payload);
    if (out) setCommand({ confirmed: false, priority: 3 });
  }

  async function runTest() {
    setBusy(true); setMessage(''); setTestResult(null);
    const proposed = test.proposed_title || test.proposed_content
      ? { title: test.proposed_title, content: test.proposed_content, scope: test.proposed_scope, priority: 5 }
      : null;
    const response = await fetch('/api/admin/ai-training/test', {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ question: test.question, vehicle_id: test.vehicle_id || null, proposed_instruction: proposed }),
    });
    const json = await response.json().catch(() => ({}));
    setBusy(false);
    if (!response.ok) { setMessage(json.error || 'AI test failed'); return; }
    setTestResult(json);
  }

  function beginEdit(item: Json) {
    setEditing(Number(item.id));
    setInstruction({ title: item.title || '', content: item.content || '', scope: item.scope || 'general', priority: item.priority || 5 });
    setTab('teach');
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }

  return <>
    {!owner ? <div className="aiNotice"><ShieldCheck size={18}/> Administrators may review and correct AI answers. Only the owner can approve instructions, run operational commands, or activate corrections.</div> : null}
    <nav className="aiTabs" aria-label="AI Training sections">
      {TABS.map(([id, label, Icon]) => <button type="button" key={id} className={tab === id ? 'active' : ''}
        aria-current={tab === id ? 'page' : undefined} onClick={() => setTab(id)}><Icon size={17}/><span>{label}</span></button>)}
    </nav>
    {message ? <div className="aiMessage" role="status">{message}</div> : null}

    {tab === 'teach' ? <>
      <section className="card aiPanel">
        <h2>{editing ? 'Edit instruction' : 'Teach the AI'}</h2>
        <p className="muted">Approved instructions are loaded from MySQL on the next AI reply. Inventory, verified prices, photographs, privacy and required human approval always take precedence.</p>
        <div className="aiFormGrid">
          <label className="wide">Instruction title<input value={instruction.title} onChange={(e) => setInstruction({ ...instruction, title: e.target.value })} placeholder="Example: How to handle a customer asking for a discount" /></label>
          <label>Scope<select value={instruction.scope} onChange={(e) => setInstruction({ ...instruction, scope: e.target.value })}>
            {SCOPES.map(([value, label]) => <option value={value} key={value}>{label}</option>)}
          </select></label>
          <label>Priority (1-9)<input type="number" min={1} max={9} value={instruction.priority} onChange={(e) => setInstruction({ ...instruction, priority: e.target.value })} /></label>
          <label className="wide">Instruction<textarea rows={7} value={instruction.content} onChange={(e) => setInstruction({ ...instruction, content: e.target.value })} placeholder="Write the exact business guidance the AI should apply. Do not include credentials, SQL, shell commands or attempts to override system rules." /></label>
        </div>
        <div className="aiActions">
          {editing ? <>
            <button type="button" className="btn" disabled={busy || !owner} onClick={() => void updateInstruction(true)}><Save size={16}/> Save &amp; activate</button>
            <button type="button" className="miniBtn" disabled={busy || !owner} onClick={() => void updateInstruction(false)}>Save draft</button>
            <button type="button" className="miniBtn" onClick={() => { setEditing(null); setInstruction(emptyInstruction); }}>Cancel</button>
          </> : <>
            <button type="button" className="btn" disabled={busy || !owner} onClick={() => void saveInstruction(true)}><CheckCircle2 size={16}/> Save &amp; activate</button>
            <button type="button" className="miniBtn" disabled={busy || !owner} onClick={() => void saveInstruction(false)}>Save draft</button>
          </>}
        </div>
      </section>
      <section className="aiInstructionList">
        {(data.instructions || []).map((item: Json) => <article className="aiInstructionCard" key={item.id}>
          <header><div><span className={`aiStatus ${item.status}`}>{item.status}</span><h3>{item.title}</h3></div><span className="aiVersion">v{item.version} · {item.scope}</span></header>
          <p>{item.content}</p>
          <small>Created {when(item.created_at)} by {item.created_by || 'legacy admin'} · Updated {when(item.updated_at)}
            {item.approved_by ? ` · Approved by ${item.approved_by} ${when(item.approved_at)}` : ''}</small>
          <div className="aiActions">
            {owner && item.status !== 'approved' ? <button className="miniBtn" disabled={busy} onClick={() => void instructionAction(item.id, 'approve')}>Activate</button> : null}
            {owner && item.status === 'approved' ? <button className="miniBtn" disabled={busy} onClick={() => void instructionAction(item.id, 'deactivate')}>Disable</button> : null}
            {owner ? <button className="miniBtn" disabled={busy} onClick={() => beginEdit(item)}><Pencil size={14}/> Edit</button> : null}
            {owner && Number(item.version) > 1 ? <button className="miniBtn" disabled={busy} onClick={() => void instructionAction(item.id, 'revert')}><RotateCcw size={14}/> Revert</button> : null}
            {owner && item.status !== 'inactive' ? <button className="miniBtn danger" disabled={busy} onClick={() => void instructionAction(item.id, 'delete')}><Trash2 size={14}/> Delete</button> : null}
          </div>
        </article>)}
        {!data.instructions?.length ? <p className="muted">No instructions have been saved yet.</p> : null}
      </section>
    </> : null}

    {tab === 'corrections' ? <>
      <section className="card aiPanel">
        <h2>{editingCorrection ? `Edit correction #${editingCorrection}` : 'Correct an AI mistake'}</h2>
        <p className="muted">Corrections start pending. Conversation-linked corrections default to that customer unless you write a reusable lesson and explicitly choose global scope.</p>
        <div className="aiFormGrid">
          <label className="wide">Linked conversation<select value={correction.conversation_id} onChange={(e) => setCorrection({ ...correction, conversation_id: e.target.value })}>
            <option value="">No linked conversation</option>
            {(data.conversations || []).map((c: Json) => <option value={c.id} key={c.id}>#{c.id} · {c.full_name || c.phone || 'Customer'} · {c.channel} · {when(c.last_message_at)}</option>)}
          </select></label>
          <label>Scope<select value={correction.applies_to} onChange={(e) => setCorrection({ ...correction, applies_to: e.target.value })}><option value="global">Global reusable lesson</option><option value="customer">This customer only</option></select></label>
          <label>Category<select value={correction.category} onChange={(e) => setCorrection({ ...correction, category: e.target.value })}>{['vehicle','pricing','photos','shipping','language','availability','tone','process','other'].map((x) => <option key={x}>{x}</option>)}</select></label>
          <label className="wide">Original customer question<textarea rows={2} value={correction.question} onChange={(e) => setCorrection({ ...correction, question: e.target.value })} /></label>
          <label className="wide">Incorrect AI answer<textarea rows={3} value={correction.ai_reply} onChange={(e) => setCorrection({ ...correction, ai_reply: e.target.value })} /></label>
          <label className="wide">Correct answer<textarea rows={3} value={correction.correction} onChange={(e) => setCorrection({ ...correction, correction: e.target.value })} /></label>
          <label className="wide">Reusable lesson <span className="muted">(required for a conversation correction to apply globally)</span><textarea rows={3} value={correction.lesson} onChange={(e) => setCorrection({ ...correction, lesson: e.target.value })} /></label>
          <label>Reason for correction<input value={correction.reason} onChange={(e) => setCorrection({ ...correction, reason: e.target.value })} /></label>
          <label>Supporting source<input value={correction.evidence} onChange={(e) => setCorrection({ ...correction, evidence: e.target.value })} placeholder="Approved price sheet, staff note, message id…" /></label>
        </div>
        <div className="aiActions">
          <button type="button" className="btn" disabled={busy} onClick={() => void addCorrection()}><Save size={16}/> {editingCorrection ? 'Save correction changes' : 'Save pending correction'}</button>
          {editingCorrection ? <button type="button" className="miniBtn" onClick={() => { setCorrection(emptyCorrection); setEditingCorrection(null); }}>Cancel</button> : null}
        </div>
      </section>
      <div className="aiCorrectionList">
        {(data.corrections || []).map((item: Json) => <article className="aiCorrectionCard" key={item.id}>
          <header><span className={`aiStatus ${item.status}`}>{item.status}</span><b>Correction #{item.id} · v{correctionVersion(item)}</b><small>{item.category} · {item.applies_to === 'customer' ? 'customer-only' : 'global'}</small></header>
          <dl>
            <dt>Customer question</dt><dd>{item.question || '-'}</dd>
            <dt>Incorrect answer</dt><dd>{item.ai_reply || '-'}</dd>
            <dt>Correct answer</dt><dd>{item.correction || '-'}</dd>
            <dt>Reusable lesson</dt><dd>{item.lesson || '-'}</dd>
            <dt>Reason / source</dt><dd>{item.reason || '-'}{item.evidence_ref ? ` · ${item.evidence_ref}` : ''}</dd>
            <dt>Audit</dt><dd>{when(item.created_at)} · {item.created_by || 'admin'} · reviewed by {item.reviewed_by || '-'} {when(item.reviewed_at)}</dd>
          </dl>
          <div className="aiActions">
            {['pending'].includes(item.status) ? <button className="miniBtn" disabled={busy || !owner} onClick={() => void correctionAction(item, 'approve')}>Approve</button> : null}
            {item.status === 'pending' ? <button className="miniBtn danger" disabled={busy || !owner} onClick={() => void correctionAction(item, 'reject')}>Reject</button> : null}
            {item.status === 'approved' ? <button className="miniBtn" disabled={busy || !owner} onClick={() => void correctionAction(item, 'apply')}>Apply to AI</button> : null}
            {['approved','applied'].includes(item.status) ? <button className="miniBtn danger" disabled={busy || !owner} onClick={() => void correctionAction(item, 'undo')}>Undo</button> : null}
            {['approved','applied'].includes(item.status) ? <button className="miniBtn danger" disabled={busy || !owner} onClick={() => void correctionAction(item, 'disable')}>Disable</button> : null}
            <button className="miniBtn" disabled={busy} onClick={() => {
              setEditingCorrection(Number(item.id));
              setCorrection({
                conversation_id: item.conversation_id || '', question: item.question || '', ai_reply: item.ai_reply || '',
                correction: item.correction || '', lesson: item.lesson || '', reason: item.reason || '',
                evidence: item.evidence_ref || '', applies_to: item.applies_to || 'global', category: item.category || 'process',
              });
              window.scrollTo({ top: 0, behavior: 'smooth' });
            }}><Pencil size={14}/> Edit</button>
            {!['approved','applied'].includes(item.status) ? <button className="miniBtn danger" disabled={busy || !owner} onClick={() => void correctionAction(item, 'delete')}>Delete from AI</button> : null}
            {item.conversation_id ? <a className="miniBtn" href={`/admin/whatsapp?conversation=${item.conversation_id}`}>Open conversation</a> : null}
          </div>
        </article>)}
      </div>
    </> : null}

    {tab === 'commands' ? <section className="card aiPanel">
      <h2>Authorized business commands</h2>
      {!owner ? <div className="aiNotice">Owner access is required for operational commands.</div> : null}
      <p className="muted">This interface has a fixed allow-list. It cannot run shell commands, arbitrary code, unrestricted SQL, reveal secrets or bypass authorization.</p>
      <label>Command<select disabled={!owner} value={commandType} onChange={(e) => { setCommandType(e.target.value); setCommand({ confirmed: false, priority: 3 }); }}>
        <option value="update_instruction">Update an approved instruction</option>
        <option value="disable_lesson">Disable an outdated lesson</option>
        <option value="set_response_style">Set preferred response style</option>
        <option value="add_faq">Add a verified FAQ</option>
        <option value="request_followup">Request a customer follow-up</option>
        <option value="request_inventory_review">Request an inventory review</option>
      </select></label>
      <div className="aiFormGrid">
        {commandType === 'update_instruction' ? <>
          <label className="wide">Instruction<select value={command.instruction_id || ''} onChange={(e) => setCommand({ ...command, instruction_id: e.target.value })}><option value="">Choose an active instruction</option>{instructionOptions.map((x: Json) => <option value={x.id} key={x.id}>#{x.id} · {x.title}</option>)}</select></label>
          <label className="wide">New title<input value={command.title || ''} onChange={(e) => setCommand({ ...command, title: e.target.value })} /></label>
          <label className="wide">New instruction<textarea rows={4} value={command.content || ''} onChange={(e) => setCommand({ ...command, content: e.target.value })} /></label>
        </> : null}
        {commandType === 'disable_lesson' ? <label className="wide">Lesson<select value={command.learning_id || ''} onChange={(e) => setCommand({ ...command, learning_id: e.target.value })}><option value="">Choose an approved or applied lesson</option>{lessonOptions.map((x: Json) => <option value={x.id} key={x.id}>#{x.id} · {x.reason || x.lesson}</option>)}</select></label> : null}
        {commandType === 'set_response_style' ? <>
          <label>Maximum sentences<input type="number" min={1} max={6} value={command.max_sentences || 3} onChange={(e) => setCommand({ ...command, max_sentences: e.target.value })} /></label>
          <label><span>Team voice</span><input type="checkbox" checked={command.team_voice !== false} onChange={(e) => setCommand({ ...command, team_voice: e.target.checked })} /></label>
          <label><span>Price first when known</span><input type="checkbox" checked={command.price_first !== false} onChange={(e) => setCommand({ ...command, price_first: e.target.checked })} /></label>
          <label><span>One question maximum</span><input type="checkbox" checked={command.one_question !== false} onChange={(e) => setCommand({ ...command, one_question: e.target.checked })} /></label>
        </> : null}
        {commandType === 'add_faq' ? <>
          <label className="wide">Verified FAQ title<input value={command.title || ''} onChange={(e) => setCommand({ ...command, title: e.target.value })} /></label>
          <label className="wide">Verified answer<textarea rows={4} value={command.content || ''} onChange={(e) => setCommand({ ...command, content: e.target.value })} /></label>
        </> : null}
        {commandType === 'request_followup' ? <>
          <label className="wide">Conversation<select value={command.conversation_id || ''} onChange={(e) => setCommand({ ...command, conversation_id: e.target.value })}><option value="">Choose a conversation</option>{(data.conversations || []).map((x: Json) => <option value={x.id} key={x.id}>#{x.id} · {x.full_name || x.phone || 'Customer'}</option>)}</select></label>
          <label className="wide">Reason/instructions<textarea rows={3} value={command.reason || ''} onChange={(e) => setCommand({ ...command, reason: e.target.value })} /></label>
        </> : null}
        {commandType === 'request_inventory_review' ? <>
          <label>Stock number <span className="muted">(optional)</span><input value={command.stock_no || ''} onChange={(e) => setCommand({ ...command, stock_no: e.target.value })} /></label>
          <label className="wide">Review scope<textarea rows={3} value={command.reason || ''} onChange={(e) => setCommand({ ...command, reason: e.target.value })} /></label>
        </> : null}
      </div>
      <label className="aiConfirm"><input type="checkbox" checked={!!command.confirmed} onChange={(e) => setCommand({ ...command, confirmed: e.target.checked })} /> I understand this command changes an owner-controlled business workflow.</label>
      <button type="button" className="btn" disabled={busy || !owner || !command.confirmed} onClick={() => void runCommand()}><Command size={16}/> Run authorized command</button>
    </section> : null}

    {tab === 'history' ? <>
      <section className="card aiPanel">
        <h2>Instruction and approval history</h2>
        <div className="aiHistory">
          {(data.history || []).map((h: Json) => {
            let snap: Json = {};
            try { snap = typeof h.snapshot === 'string' ? JSON.parse(h.snapshot) : h.snapshot || {}; } catch {}
            return <article key={h.id}><span>{h.action.replaceAll('_',' ')}</span><b>#{h.instruction_id} · v{h.version}</b><small>{when(h.created_at)} · {h.actor || 'admin'}</small><p>{snap.title || 'Instruction snapshot'}{snap.scope ? ` · ${snap.scope}` : ''}{snap.status ? ` · ${snap.status}` : ''}</p></article>;
          })}
        </div>
      </section>
      <section className="card aiPanel">
        <h2>Audit trail</h2>
        <div className="aiAuditTable">
          {(data.audit || []).map((a: Json) => <div key={a.id}><b>{a.action.replaceAll('.', ' / ').replaceAll('_',' ')}</b><span>{a.entity_type} {a.entity_id || ''}</span><small>{when(a.created_at)} · {a.actor || 'admin'}</small></div>)}
          {!data.audit?.length ? <p className="muted">No AI-training audit actions yet.</p> : null}
        </div>
      </section>
    </> : null}

    {tab === 'test' ? <>
      <section className="card aiPanel">
        <h2>Test the AI</h2>
        <p className="muted">This is a dry run: no customer message is sent and no conversation is changed. You can test an unapproved proposed instruction without activating it.</p>
        <div className="aiFormGrid">
          <label className="wide">Customer question<textarea rows={3} value={test.question} onChange={(e) => setTest({ ...test, question: e.target.value })} placeholder="How much is this vehicle and does it have original photos?" /></label>
          <label className="wide">Specified vehicle<select value={test.vehicle_id} onChange={(e) => setTest({ ...test, vehicle_id: e.target.value })}><option value="">Let the AI match the question</option>{(data.vehicles || []).map((v: Json) => <option value={v.id} key={v.id}>#{v.id} · {v.stock_no} · {[v.model_year,v.brand,v.model].filter(Boolean).join(' ')} · {v.status}{v.ai_enabled ? ' · AI enabled' : ' · not AI-enabled'}</option>)}</select></label>
          <label>Proposed instruction title<input value={test.proposed_title} onChange={(e) => setTest({ ...test, proposed_title: e.target.value })} /></label>
          <label>Proposed scope<select value={test.proposed_scope} onChange={(e) => setTest({ ...test, proposed_scope: e.target.value })}>{SCOPES.map(([value, label]) => <option value={value} key={value}>{label}</option>)}</select></label>
          <label className="wide">Proposed instruction content<textarea rows={3} value={test.proposed_content} onChange={(e) => setTest({ ...test, proposed_content: e.target.value })} /></label>
        </div>
        <button type="button" className="btn" disabled={busy || !test.question.trim()} onClick={() => void runTest()}><FlaskConical size={16}/> Run dry test</button>
      </section>
      {testResult ? <section className="card aiPanel">
        <h2>Planned reply</h2>
        <div className="aiReply">{testResult.reply || '(empty)'}</div>
        {testResult.vehicle ? <p><b>Vehicle:</b> {testResult.vehicle.title} · stock {testResult.vehicle.stock_no}</p> : null}
        <div className="aiTrace">
          <h3>Business sources supplied</h3>
          {(testResult.influences?.instructions || []).map((x: Json) => <div key={`i-${x.id}`}><BookOpenCheck size={15}/><span>Instruction #{x.id} · {x.title}</span><small>v{x.version} · {x.scope} · relevance {x.relevance}%</small></div>)}
          {(testResult.influences?.lessons || []).map((x: Json) => <div key={`l-${x.id}`}><ShieldCheck size={15}/><span>Lesson #{x.id} · {x.event_type}</span><small>{x.relevance == null ? 'active' : `relevance ${Math.round(Number(x.relevance) * 100)}%`}</small></div>)}
          <p className="muted">Business policy version {testResult.influences?.business_policy_version}. {testResult.trace_note}</p>
        </div>
      </section> : null}
    </> : null}
  </>;
}
