export interface Service {
  id: number;
  name: string;
  duration_min: number;
  buffer_before_min: number;
  buffer_min: number;
  price_cents: number;
}
export interface Resource {
  id: number;
  name: string;
  business_type: string;
  title: string;
  bio: string;
  emoji: string;
  color: string;
  location_name: string;
  location_address: string;
  organization_name: string;
  timezone: string;
  services: Service[];
  schedules: { weekday: number; start_time: string; end_time: string }[];
}
export interface Candidate {
  start: string;
  end: string;
  resourceId: number;
  serviceId: number;
  resourceName: string;
  serviceName: string;
  location: string;
  date: string;
  time: string;
  reason: string;
  timezone: string;
  score: number;
  components: Record<string, number>;
}
export interface Booking {
  id: number;
  code: string;
  provider_id: number;
  service_id: number;
  resource_name: string;
  business_type: string;
  service_name: string;
  location_name: string;
  location_address: string;
  timezone: string;
  starts_at: string;
  ends_at: string;
  expires_at: string | null;
  status: string;
  version: number;
  events: { id: number; event: string; actor: string; detail: string; created_at: string }[];
}
export interface QueueEntry {
  id: number;
  resource_name: string;
  status: string;
  date: string;
  earliest_time: string;
  latest_time: string;
  created_at: string;
}
export interface Notice {
  id: number;
  title: string;
  message: string;
  created_at: string;
}
export interface User {
  id: number;
  name: string;
  email: string;
}
