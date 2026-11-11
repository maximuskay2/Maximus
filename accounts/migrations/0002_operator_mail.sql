-- The operator mailbox the admin dashboard edits. One row. A blank password on
-- update keeps the saved secret; reads never return it.
CREATE TABLE operator_mail (
  id integer PRIMARY KEY CHECK (id = 1),
  host text NOT NULL,
  port integer NOT NULL CHECK (port BETWEEN 1 AND 65535),
  username text NOT NULL DEFAULT '',
  password text NOT NULL DEFAULT '',
  from_email text NOT NULL,
  updated_at timestamptz NOT NULL DEFAULT now()
);
