import Chat from './flow/Chat';
import {Routes,Route,Navigate} from 'react-router-dom';
import {FlowProvider} from './flow/context';
import Shell from './flow/Shell';
import Overview from './flow/Overview';
import Planner from './flow/Planner';
import Bookings from './flow/Bookings';
import Waitlist from './flow/Waitlist';
import Inbox from './flow/Inbox';
import Operations from './flow/Operations';
import Settings from './flow/Settings';
import Profile from './flow/Profile';
import './flow/styles.css';
export default function App(){return <FlowProvider><Routes><Route element={<Shell/>}><Route index element={<Overview/>}/><Route path="chat" element={<Chat/>}/><Route path="planner" element={<Planner/>}/><Route path="bookings" element={<Bookings/>}/><Route path="waitlist" element={<Waitlist/>}/><Route path="inbox" element={<Inbox/>}/><Route path="profile" element={<Profile/>}/><Route path="settings" element={<Settings/>}/><Route path="operations" element={<Operations/>}/><Route path="*" element={<Navigate to="/" replace/>}/></Route></Routes></FlowProvider>;}
