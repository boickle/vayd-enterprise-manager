# Tasks API — frontend reference

## 6. Frontend quick reference (`startAt`)

### Read

- `GET /tasks` and `GET /tasks/:id` — each task includes `startAt` and `dueAt` (`string | null`, ISO 8601).

### Write

- `POST /tasks` — optional `startAt`, optional `dueAt` (same shape as `dueAt` today).
- `PATCH /tasks/:id` — optional `startAt` and/or `dueAt`; send `null` to clear.

### Semantics

- `startAt` = when work should begin (scheduling window start).
- `dueAt` = deadline / end of window.
- Not “visible from” — use `created` for that.
- Both optional. If both are set, `startAt` ≤ `dueAt` or API returns **400**.

### History events

- `start_at_changed` — same payload pattern as `due_at_changed` (typically `from` / `to` ISO strings).
- `due_at_changed` — due date updated.

### Priority

- `null` or omitted = **not urgent** (default).
- `1` = **urgent** (shows in the Urgent section on the tasks board).

### Example create body

```json
{
  "title": "This needs to be done.",
  "branchIds": [1],
  "assignedToEmployeeId": 1,
  "startAt": "2026-05-29T12:00:00.000-04:00",
  "dueAt": "2026-05-29T16:36:00.000-04:00"
}
```
