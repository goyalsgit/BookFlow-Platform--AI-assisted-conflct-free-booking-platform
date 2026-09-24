CREATE TABLE workspace_events (
 id SERIAL PRIMARY KEY, organization_id INT NOT NULL REFERENCES organizations(id), actor_id INT NOT NULL REFERENCES users(id),
 action TEXT NOT NULL, resource_id INT REFERENCES providers(id), detail JSONB NOT NULL DEFAULT '{}', created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX workspace_events_org ON workspace_events(organization_id,id);
