# BookFlow build steps

Product: a configurable scheduling and allocation workspace for small businesses. Resources can be people, rooms, equipment, vehicles or anything exclusively bookable. Resource types are configuration, not fixed business categories.

1. [x] Inspect and preserve BookIt's database and transaction architecture and MIT license.
2. [x] Run isolated PostgreSQL with Docker and apply versioned migrations.
3. [x] Implement timezone-aware availability and database-enforced buffered conflicts.
4. [x] Implement five-minute holds, confirmation, atomic changes and FIFO compatible waitlist offers.
5. [ ] Generalize business settings, types, services and working hours in the UI.
6. [ ] Finish and inspect the responsive customer and operations interfaces.
7. [ ] Verify real API concurrency, permissions, lifecycle, ranking and browser journeys.
8. [ ] Write setup and plain-language architecture/function learning guides.
9. [ ] Report verified functionality and remaining SRS scope honestly.
