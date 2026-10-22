import Chat from './flow/Chat';
import SeatPools from './flow/SeatPools';
import { Routes, Route, Navigate, Outlet } from 'react-router-dom';
import { FlowProvider, useFlow } from './flow/context';
import Shell from './flow/Shell';
import Overview from './flow/Overview';
import Planner from './flow/Planner';
import Bookings from './flow/Bookings';
import Waitlist from './flow/Waitlist';
import Inbox from './flow/Inbox';
import Operations from './flow/Operations';
import Settings from './flow/Settings';
import Profile from './flow/Profile';
import AccountAction from './flow/AccountAction';
import AccountRoutes from './flow/AccountRoutes';
import './flow/styles.css';

// Customer and guest URLs must not render owner management screens.
function OwnerRoutes() {
  const { admin } = useFlow();
  return admin ? <Outlet /> : <Navigate to="/" replace />;
}
export default function App() {
  return (
    <FlowProvider>
      <Routes>
        <Route element={<Shell />}>
          <Route index element={<Overview />} />
          <Route path="chat" element={<Chat />} />
          <Route path="planner" element={<Planner />} />
          <Route path="seat-pools" element={<SeatPools />} />
          <Route element={<AccountRoutes />}>
            <Route path="bookings" element={<Bookings />} />
            <Route path="waitlist" element={<Waitlist />} />
            <Route path="profile" element={<Profile />} />
          </Route>
          <Route element={<AccountRoutes allowOwner />}>
            <Route path="inbox" element={<Inbox />} />
          </Route>
          <Route element={<OwnerRoutes />}>
            <Route path="settings" element={<Settings />} />
            <Route path="operations" element={<Operations />} />
          </Route>
          <Route path="account/reset" element={<AccountAction purpose="reset" />} />
          <Route path="account/verify" element={<AccountAction purpose="verify" />} />
          <Route path="*" element={<Navigate to="/" replace />} />
        </Route>
      </Routes>
    </FlowProvider>
  );
}
