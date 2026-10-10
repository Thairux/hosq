import { useEffect, useState } from 'react';
import { supabase } from '../lib/supabase';
import { createConfirmedUser } from '../lib/supabase-admin';
import { useAuth } from '../contexts/AuthContext';
import { EMAIL_RE } from '../lib/email';
import type { Database } from '../lib/database.types';
import { Users, Settings, UserPlus, Shield, AlertTriangle, SlidersHorizontal, RefreshCw, DatabaseZap } from 'lucide-react';

type Tab = 'users' | 'stages' | 'flags' | 'ops';

export function AdminDashboard() {
  const { userRole } = useAuth();
  const [tab, setTab] = useState<Tab>('users');
  const [employees, setEmployees] = useState<any[]>([]);
  const [stages, setStages] = useState<any[]>([]);
  const [flags, setFlags] = useState<any[]>([]);
  const [overrides, setOverrides] = useState<any[]>([]);
  const [showAddUser, setShowAddUser] = useState(false);
  const [loading, setLoading] = useState(false);
  const [refreshingOps, setRefreshingOps] = useState(false);

  const [emailEnabled, setEmailEnabled] = useState(true);
  const [emailHealth, setEmailHealth] = useState('Checking email health...');
  const [testEmailAddress, setTestEmailAddress] = useState('');
  const [testEmailStatus, setTestEmailStatus] = useState('');

  const [cooldownEmail, setCooldownEmail] = useState('');
  const [cooldownHours, setCooldownHours] = useState(6);
  const [cooldownReason, setCooldownReason] = useState('Admin override');
  const [cooldownStatus, setCooldownStatus] = useState('');

  const [newUser, setNewUser] = useState({
    email: '',
    password: '',
    role: 'receptionist',
    department: '',
    email_verified: false,
  });

  useEffect(() => {
    void refreshCore();
    void refreshOps();
  }, []);

  const refreshCore = async () => {
    const [emp, stg, flg] = await Promise.all([
      supabase.from('user_roles').select('*').order('created_at', { ascending: false }),
      supabase.from('queue_stages').select('*').order('order_number', { ascending: true }),
      supabase.from('emergency_flags').select('*').order('name', { ascending: true }),
    ]);
    setEmployees(emp.data || []);
    setStages(stg.data || []);
    setFlags(flg.data || []);
  };

  const refreshOps = async () => {
    setRefreshingOps(true);
    const [setting, ovrd] = await Promise.all([
      (supabase as any).from('system_settings').select('value').eq('key', 'email_enabled').maybeSingle(),
      (supabase as any).from('checkin_cooldown_overrides').select('*').order('created_at', { ascending: false }).limit(30),
    ]);
    const enabled = setting?.data?.value?.enabled !== false;
    setEmailEnabled(enabled);
    setOverrides(ovrd.data || []);

    try {
      const res = await fetch(`${import.meta.env.VITE_SUPABASE_URL}/functions/v1/send-email`, {
        method: 'OPTIONS',
      });
      setEmailHealth(res.ok ? 'Email function reachable.' : `Email issue: HTTP ${res.status}`);
    } catch {
      setEmailHealth('Email health check failed.');
    }
    setRefreshingOps(false);
  };

  const createUser = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    const result = await createConfirmedUser(newUser.email, newUser.password, {
      role: newUser.role,
      department: newUser.department,
    });
    if (!result.success || !result.userId) {
      alert(result.error || 'User creation failed');
      setLoading(false);
      return;
    }
    const { error } = await supabase.from('user_roles').insert({
      user_id: result.userId,
      email: newUser.email,
      role: newUser.role,
      department: newUser.department || null,
      email_verified: newUser.email_verified,
      is_active: true,
    } as Database['public']['Tables']['user_roles']['Insert']);
    if (error) alert(error.message);
    setShowAddUser(false);
    setLoading(false);
    await refreshCore();
  };

  const toggleEmail = async () => {
    const next = !emailEnabled;
    const { error } = await (supabase as any).from('system_settings').upsert(
      { key: 'email_enabled', value: { enabled: next }, updated_by_user_id: userRole?.user_id || null },
      { onConflict: 'key' }
    );
    if (error) {
      alert(`Failed to update email setting: ${error.message}`);
      return;
    }
    setEmailEnabled(next);
  };

  const grantCooldownOverride = async (e: React.FormEvent) => {
    e.preventDefault();
    const normalized = cooldownEmail.trim().toLowerCase();
    if (!EMAIL_RE.test(normalized)) {
      setCooldownStatus('Invalid email address.');
      return;
    }
    const bypassUntil = new Date(Date.now() + cooldownHours * 60 * 60 * 1000).toISOString();
    const { error } = await (supabase as any).from('checkin_cooldown_overrides').upsert(
      {
        email: normalized,
        bypass_until: bypassUntil,
        reason: cooldownReason || null,
        created_by_user_id: userRole?.user_id || null,
      },
      { onConflict: 'email' }
    );
    if (error) {
      setCooldownStatus(`Failed: ${error.message}`);
      return;
    }
    setCooldownStatus(`Override granted for ${normalized}`);
    setCooldownEmail('');
    await refreshOps();
  };

  const removeOverride = async (id: string) => {
    const { error } = await (supabase as any).from('checkin_cooldown_overrides').delete().eq('id', id);
    if (error) {
      alert(error.message);
      return;
    }
    await refreshOps();
  };

  const [seedStatus, setSeedStatus] = useState('');

  const seedDemoData = async () => {
    setSeedStatus('Seeding...');
    try {
      const { data: stagesData, error: stagesErr } = await supabase
        .from('queue_stages')
        .select('*')
        .eq('is_active', true)
        .order('order_number', { ascending: true })
        .limit(1);
      if (stagesErr) throw stagesErr;
      const firstStage = stagesData?.[0];
      if (!firstStage) throw new Error('No active queue stage found. Please create a stage first.');

      const DEMO_PATIENTS = [
        { name: 'James Mwangi',   email: 'james.mwangi@example.com', age: 42, reason: 'Persistent headache and mild fever for 3 days, slight dizziness', emergency: false },
        { name: 'Grace Wanjiku',  email: 'grace.wanjiku@example.com', age: 28, reason: 'Sore throat and difficulty swallowing, mild ear pain since yesterday', emergency: false },
        { name: 'Peter Kamau',    email: 'peter.kamau@example.com', age: 55, reason: 'Lower back pain radiating to the left leg for about a week', emergency: false },
        { name: 'Mary Akinyi',    email: 'mary.akinyi@example.com', age: 34, reason: 'Skin rash on arms and torso with moderate itching', emergency: false },
        { name: 'David Omondi',   email: 'david.omondi@example.com', age: 19, reason: 'Stomach cramps and nausea after eating, no vomiting', emergency: false },
        { name: 'Fatuma Hassan',  email: 'fatuma.hassan@example.com', age: 61, reason: 'Swollen right ankle after a fall this morning, pain when walking', emergency: false },
        { name: 'Samuel Njoroge', email: 'samuel.njoroge@example.com', age: 47, reason: 'Persistent dry cough and mild shortness of breath for two weeks', emergency: false },
        { name: 'Agnes Chebet',   email: 'agnes.chebet@example.com', age: 23, reason: 'Irregular menstrual cycle and lower abdominal discomfort', emergency: false },
        { name: 'Brian Otieno',   email: 'brian.otieno@example.com', age: 38, reason: 'Severe chest pain radiating to left arm and jaw, heavy sweating and feeling faint', emergency: true },
        { name: 'Rose Wambui',    email: 'rose.wambui@example.com', age: 72, reason: 'Sudden severe headache, left-side facial drooping, slurred speech and confusion', emergency: true },
      ];

      const now = Date.now();
      for (let i = 0; i < DEMO_PATIENTS.length; i++) {
        const p = DEMO_PATIENTS[i];
        const checkedInAt = new Date(now - (DEMO_PATIENTS.length - i) * 5 * 60 * 1000).toISOString();
        const dateStr = new Date().toISOString().slice(0, 10).replace(/-/g, '');
        const qNum = `Q${dateStr}-${String(1000 + i).padStart(4, '0')}`;

        const { data: patient, error: patErr } = await supabase
          .from('patients')
          .insert({ email: p.email, full_name: p.name, age: p.age, visit_reason: p.reason })
          .select('id')
          .single();
        if (patErr) throw patErr;

        const position = p.emergency ? i + 1 : null;
        await supabase.from('queue_entries').insert({
          patient_id: patient.id,
          current_stage_id: firstStage.id,
          queue_number: qNum,
          status: 'waiting',
          has_emergency_flag: p.emergency,
          checked_in_at: checkedInAt,
          position_in_queue: position,
          notes: p.emergency ? 'Auto-flagged: high-priority symptoms' : null,
        });
      }

      setSeedStatus('10 demo patients seeded — 2 marked as emergency and will appear at the top of the queue.');
    } catch (err: any) {
      setSeedStatus(`Error: ${err.message}`);
    }
  };

  const sendTestEmail = async () => {
    setTestEmailStatus('');
    const res = await fetch(`${import.meta.env.VITE_SUPABASE_URL}/functions/v1/send-email`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${import.meta.env.VITE_SUPABASE_ANON_KEY}`,
        apikey: import.meta.env.VITE_SUPABASE_ANON_KEY,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ to: testEmailAddress, subject: 'Admin test email', message: 'Admin test email' }),
    });
    const body = await res.json();
    setTestEmailStatus(res.ok ? 'Sent.' : body?.error || 'Failed.');
  };

  const toggleUser = async (userId: string, isActive: boolean) => {
    await supabase.from('user_roles').update({ is_active: !isActive }).eq('user_id', userId);
    await refreshCore();
  };

  return (
    <div className="min-h-screen bg-gray-50 p-3 sm:p-6">
      <div className="max-w-7xl mx-auto">
        <h1 className="text-2xl sm:text-3xl font-bold text-gray-900 mb-2">Admin Dashboard</h1>
        <p className="text-gray-600 mb-6 text-sm sm:text-base">Mobile-friendly controls for staff, queues, email, and diagnostics.</p>

        <div className="bg-white rounded-lg shadow mb-6">
          <div className="border-b border-gray-200 overflow-x-auto">
            <nav className="flex min-w-max">
              <button onClick={() => setTab('users')} className={`px-4 py-3 text-sm ${tab === 'users' ? 'text-blue-600 border-b-2 border-blue-500' : 'text-gray-600'}`}><Users className="w-4 h-4 inline mr-2" />Users</button>
              <button onClick={() => setTab('stages')} className={`px-4 py-3 text-sm ${tab === 'stages' ? 'text-blue-600 border-b-2 border-blue-500' : 'text-gray-600'}`}><Settings className="w-4 h-4 inline mr-2" />Stages</button>
              <button onClick={() => setTab('flags')} className={`px-4 py-3 text-sm ${tab === 'flags' ? 'text-blue-600 border-b-2 border-blue-500' : 'text-gray-600'}`}><AlertTriangle className="w-4 h-4 inline mr-2" />Flags</button>
              <button onClick={() => setTab('ops')} className={`px-4 py-3 text-sm ${tab === 'ops' ? 'text-blue-600 border-b-2 border-blue-500' : 'text-gray-600'}`}><SlidersHorizontal className="w-4 h-4 inline mr-2" />Ops</button>
            </nav>
          </div>
          <div className="p-4 sm:p-6">
            {tab === 'users' && (
              <div>
                <div className="flex flex-col sm:flex-row gap-3 sm:items-center sm:justify-between mb-4">
                  <h2 className="text-xl font-semibold">Staff Members</h2>
                  <button onClick={() => setShowAddUser(!showAddUser)} className="px-4 py-2 bg-blue-600 text-white rounded-lg"><UserPlus className="w-4 h-4 inline mr-2" />Add Staff</button>
                </div>
                {showAddUser && (
                  <form onSubmit={createUser} className="bg-gray-50 border rounded-lg p-4 mb-4 grid grid-cols-1 md:grid-cols-2 gap-3">
                    <input required type="email" value={newUser.email} onChange={(e) => setNewUser({ ...newUser, email: e.target.value })} placeholder="Email" className="border rounded-lg px-3 py-2" />
                    <input required type="password" value={newUser.password} onChange={(e) => setNewUser({ ...newUser, password: e.target.value })} placeholder="Password" className="border rounded-lg px-3 py-2" />
                    <select value={newUser.role} onChange={(e) => setNewUser({ ...newUser, role: e.target.value })} className="border rounded-lg px-3 py-2"><option value="receptionist">Receptionist</option><option value="triage">Triage</option><option value="doctor">Doctor</option><option value="billing">Billing</option><option value="pharmacist">Pharmacist</option><option value="admin">Admin</option></select>
                    <input type="text" value={newUser.department} onChange={(e) => setNewUser({ ...newUser, department: e.target.value })} placeholder="Department" className="border rounded-lg px-3 py-2" />
                    <button disabled={loading} className="md:col-span-2 bg-blue-600 text-white rounded-lg px-3 py-2">{loading ? 'Creating...' : 'Create User'}</button>
                  </form>
                )}
                <div className="overflow-x-auto"><table className="w-full min-w-[680px]"><thead><tr className="text-left text-xs text-gray-500 uppercase"><th className="py-2">Email</th><th>Role</th><th>Department</th><th>Status</th><th>Action</th></tr></thead><tbody>{employees.map((u) => <tr key={u.id} className="border-t"><td className="py-2">{u.email}</td><td><Shield className="w-4 h-4 inline mr-1 text-gray-400" />{u.role}</td><td>{u.department || '-'}</td><td>{u.is_active ? 'Active' : 'Inactive'}</td><td><button onClick={() => toggleUser(u.user_id, u.is_active)} className="text-blue-600">{u.is_active ? 'Deactivate' : 'Activate'}</button></td></tr>)}</tbody></table></div>
              </div>
            )}

            {tab === 'stages' && <div className="space-y-3">{stages.map((s) => <div key={s.id} className="p-3 border rounded-lg flex items-center justify-between"><div><p className="font-medium">{s.display_name}</p><p className="text-sm text-gray-500">Order {s.order_number}</p></div><button onClick={() => supabase.from('queue_stages').update({ is_active: !s.is_active }).eq('id', s.id).then(refreshCore)} className="text-blue-600">{s.is_active ? 'Deactivate' : 'Activate'}</button></div>)}</div>}
            {tab === 'flags' && <div className="space-y-3">{flags.map((f) => <div key={f.id} className="p-3 border rounded-lg flex items-center justify-between"><div><p className="font-medium">{f.name}</p><p className="text-sm text-gray-500">{f.description}</p></div><button onClick={() => supabase.from('emergency_flags').update({ is_active: !f.is_active }).eq('id', f.id).then(refreshCore)} className="text-blue-600">{f.is_active ? 'Deactivate' : 'Activate'}</button></div>)}</div>}

            {tab === 'ops' && (
              <div className="space-y-4">
                <div className="flex flex-col sm:flex-row gap-2 sm:items-center sm:justify-between">
                  <h2 className="text-xl font-semibold">Operations & Diagnostics</h2>
                  <button onClick={refreshOps} disabled={refreshingOps} className="px-3 py-2 rounded-lg bg-gray-100"><RefreshCw className={`w-4 h-4 inline mr-2 ${refreshingOps ? 'animate-spin' : ''}`} />Refresh</button>
                </div>
                <div className="p-3 rounded-lg border bg-gray-50 text-sm">{emailHealth}</div>
                <div className="p-4 border border-dashed border-purple-300 bg-purple-50 rounded-lg flex flex-col sm:flex-row sm:items-center gap-3">
                  <div className="flex-1">
                    <p className="font-semibold text-purple-900">Seed Demo Data</p>
                    <p className="text-sm text-purple-700">Adds 10 fake patients to the queue (8 regular, 2 emergency) for demonstration purposes.</p>
                    {seedStatus && <p className="text-sm mt-1 font-medium text-purple-800">{seedStatus}</p>}
                  </div>
                  <button onClick={seedDemoData} className="flex items-center gap-2 px-4 py-2 bg-purple-600 text-white rounded-lg hover:bg-purple-700 transition-colors whitespace-nowrap">
                    <DatabaseZap className="w-4 h-4" />Seed Demo Data
                  </button>
                </div>
                <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
                  <div className="p-4 border rounded-lg">
                    <p className="font-semibold mb-2">Global Email Switch</p>
                    <button onClick={toggleEmail} className={`px-4 py-2 rounded-lg text-white ${emailEnabled ? 'bg-green-600' : 'bg-red-600'}`}>{emailEnabled ? 'Enabled' : 'Disabled'}</button>
                  </div>
                  <div className="p-4 border rounded-lg space-y-2">
                    <p className="font-semibold">Send Test Email</p>
                    <input type="email" value={testEmailAddress} onChange={(e) => setTestEmailAddress(e.target.value)} placeholder="you@example.com" className="w-full border rounded-lg px-3 py-2" />
                    <button onClick={sendTestEmail} className="px-4 py-2 bg-blue-600 text-white rounded-lg">Send</button>
                    {testEmailStatus && <p className="text-sm text-gray-700">{testEmailStatus}</p>}
                  </div>
                </div>
                <div className="p-4 border rounded-lg">
                  <p className="font-semibold mb-2">Restore Cooled-Down Email</p>
                  <form onSubmit={grantCooldownOverride} className="grid grid-cols-1 md:grid-cols-4 gap-2">
                    <input required type="email" value={cooldownEmail} onChange={(e) => setCooldownEmail(e.target.value)} placeholder="you@example.com" className="md:col-span-2 border rounded-lg px-3 py-2" />
                    <input type="number" min={1} value={cooldownHours} onChange={(e) => setCooldownHours(parseInt(e.target.value || '6', 10))} className="border rounded-lg px-3 py-2" />
                    <button className="bg-amber-600 text-white rounded-lg px-3 py-2">Grant Override</button>
                    <input value={cooldownReason} onChange={(e) => setCooldownReason(e.target.value)} placeholder="Reason" className="md:col-span-4 border rounded-lg px-3 py-2" />
                  </form>
                  {cooldownStatus && <p className="text-sm mt-2">{cooldownStatus}</p>}
                  <div className="overflow-x-auto mt-3">
                    <table className="w-full min-w-[620px] text-sm"><thead><tr className="text-left text-xs uppercase text-gray-500"><th className="py-2">Email</th><th>Bypass Until</th><th>Reason</th><th>Action</th></tr></thead><tbody>{overrides.map((o) => <tr key={o.id} className="border-t"><td className="py-2">{o.email || o.phone_number || '-'}</td><td>{new Date(o.bypass_until).toLocaleString()}</td><td>{o.reason || '-'}</td><td><button onClick={() => removeOverride(o.id)} className="text-red-600">Remove</button></td></tr>)}</tbody></table>
                  </div>
                </div>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
