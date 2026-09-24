import { useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useFlow } from './context';
import { request } from './api';
import { Empty, ErrorMessage, Icon, Loading } from './ui';

type ProfileData = { id: number; name: string; email: string; phone: string; created_at: string };

export default function Profile() {
  const { user, signIn, logout, updateCustomer, toast } = useFlow();
  const navigate = useNavigate();
  const [profile, setProfile] = useState<ProfileData | null>(null);
  const [name, setName] = useState('');
  const [phone, setPhone] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!user) { setProfile(null); return; }
    setError('');
    request<ProfileData>('/profile')
      .then((data) => { setProfile(data); setName(data.name); setPhone(data.phone); })
      .catch((e) => setError(e.message));
  }, [user?.id]);

  if (!user) return <Empty title="Your account, in one place" icon="grid">
    <p>Sign in as a customer to manage your profile and bookings.</p>
    <button className="bf-button primary" onClick={() => signIn()}>Customer sign in</button>
  </Empty>;

  return <>
    <div className="bf-page-heading"><div>
      <div className="bf-eyebrow">YOUR ACCOUNT</div>
      <h1>Good to see you, {user.name.split(' ')[0]}<span>.</span></h1>
      <p>Keep your contact details current and find your bookings.</p>
    </div></div>
    <ErrorMessage message={error} />
    {!profile && !error ? <Loading /> : profile && <div className="bf-settings-grid">
      <section className="bf-panel bf-settings-panel">
        <h2>Profile details</h2>
        <p>Your email is used to sign in. Name and phone can be updated here.</p>
        <form onSubmit={async (event) => {
          event.preventDefault(); setBusy(true); setError('');
          try {
            const updated = await request<ProfileData>('/profile', 'PATCH', { name, phone });
            setProfile(updated);
            updateCustomer({ id: updated.id, name: updated.name, email: updated.email });
            toast('Profile updated.');
          } catch (e: any) { setError(e.message); }
          finally { setBusy(false); }
        }}>
          <label>Your name<input required minLength={2} maxLength={100} value={name} onChange={(e) => setName(e.target.value)} /></label>
          <label>Email address<input type="email" value={profile.email} readOnly /></label>
          <label>Phone number<input type="tel" maxLength={30} value={phone} onChange={(e) => setPhone(e.target.value)} placeholder="Optional" /></label>
          <button className="bf-button primary" disabled={busy}>{busy ? 'Saving…' : 'Save profile'} <Icon name="check" size={16} /></button>
        </form>
      </section>
      <section className="bf-panel bf-settings-panel">
        <h2>Your activity</h2>
        <p>See upcoming, past, and cancelled reservations in My bookings.</p>
        <Link className="bf-button secondary" to="/bookings"><Icon name="calendar" size={17} /> My bookings</Link>
        <div className="bf-profile-separator" />
        <p>Account created {new Date(profile.created_at).toLocaleDateString()}.</p>
        <button className="bf-button secondary" onClick={() => { logout(); navigate('/'); }}><Icon name="logout" size={17} /> Sign out</button>
      </section>
    </div>}
  </>;
}
