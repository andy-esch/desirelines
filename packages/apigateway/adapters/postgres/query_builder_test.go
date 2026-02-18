package postgres

import (
	"testing"
)

func TestNewQueryBuilder(t *testing.T) {
	qb := newQueryBuilder("SELECT * FROM t WHERE 1=1")

	if qb.query != "SELECT * FROM t WHERE 1=1" {
		t.Errorf("unexpected query: %s", qb.query)
	}
	if qb.argNum != 1 {
		t.Errorf("expected argNum 1, got %d", qb.argNum)
	}
	if len(qb.args) != 0 {
		t.Errorf("expected empty args, got %v", qb.args)
	}
}

func TestQueryBuilder_AddCondition_SinglePlaceholder(t *testing.T) {
	qb := newQueryBuilder("SELECT * FROM t WHERE 1=1")
	qb.AddCondition(" AND name = $%d", "alice")

	if qb.query != "SELECT * FROM t WHERE 1=1 AND name = $1" {
		t.Errorf("unexpected query: %s", qb.query)
	}
	if len(qb.args) != 1 || qb.args[0] != "alice" {
		t.Errorf("unexpected args: %v", qb.args)
	}
	if qb.argNum != 2 {
		t.Errorf("expected argNum 2, got %d", qb.argNum)
	}
}

func TestQueryBuilder_AddCondition_MultiplePlaceholders(t *testing.T) {
	qb := newQueryBuilder("SELECT * FROM t WHERE 1=1")
	qb.AddCondition(" AND (ts, id) < ($%d::timestamp, $%d)", "2024-01-15", int64(1001))

	if qb.query != "SELECT * FROM t WHERE 1=1 AND (ts, id) < ($1::timestamp, $2)" {
		t.Errorf("unexpected query: %s", qb.query)
	}
	if len(qb.args) != 2 {
		t.Errorf("expected 2 args, got %d", len(qb.args))
	}
	if qb.argNum != 3 {
		t.Errorf("expected argNum 3, got %d", qb.argNum)
	}
}

func TestQueryBuilder_AddCondition_ChainedNumbering(t *testing.T) {
	qb := newQueryBuilder("SELECT * FROM t WHERE 1=1")
	qb.AddCondition(" AND sport = ANY($%d)", []string{"Ride"})
	qb.AddCondition(" AND year = $%d", 2024)
	qb.AddCondition(" LIMIT $%d", 20)

	expected := "SELECT * FROM t WHERE 1=1 AND sport = ANY($1) AND year = $2 LIMIT $3"
	if qb.query != expected {
		t.Errorf("unexpected query:\n got: %s\nwant: %s", qb.query, expected)
	}
	if len(qb.args) != 3 {
		t.Errorf("expected 3 args, got %d", len(qb.args))
	}
	if qb.argNum != 4 {
		t.Errorf("expected argNum 4, got %d", qb.argNum)
	}
}

func TestQueryBuilder_AddCondition_PanicsOnMismatch(t *testing.T) {
	t.Run("too few args", func(t *testing.T) {
		defer func() {
			r := recover()
			if r == nil {
				t.Fatal("expected panic, got none")
			}
			msg, ok := r.(string)
			if !ok {
				t.Fatalf("expected string panic, got %T", r)
			}
			if msg == "" {
				t.Error("expected non-empty panic message")
			}
		}()

		qb := newQueryBuilder("SELECT * FROM t WHERE 1=1")
		qb.AddCondition(" AND (ts, id) < ($%d, $%d)", "only-one-arg")
	})

	t.Run("too many args", func(t *testing.T) {
		defer func() {
			if r := recover(); r == nil {
				t.Fatal("expected panic, got none")
			}
		}()

		qb := newQueryBuilder("SELECT * FROM t WHERE 1=1")
		qb.AddCondition(" AND x = $%d", "a", "b")
	})
}

func TestQueryBuilder_AddCondition_EscapedPercent(t *testing.T) {
	qb := newQueryBuilder("SELECT * FROM t WHERE 1=1")
	// %% is an escaped percent — should not count as a placeholder
	qb.AddCondition(" AND note LIKE '100%%' AND id = $%d", 42)

	expected := "SELECT * FROM t WHERE 1=1 AND note LIKE '100%' AND id = $1"
	if qb.query != expected {
		t.Errorf("unexpected query:\n got: %s\nwant: %s", qb.query, expected)
	}
	if len(qb.args) != 1 || qb.args[0] != 42 {
		t.Errorf("unexpected args: %v", qb.args)
	}
}

func TestQueryBuilder_AddCondition_NoPlaceholders(t *testing.T) {
	qb := newQueryBuilder("SELECT * FROM t WHERE 1=1")
	// Zero placeholders, zero args — should not panic
	qb.AddCondition(" ORDER BY id DESC")

	expected := "SELECT * FROM t WHERE 1=1 ORDER BY id DESC"
	if qb.query != expected {
		t.Errorf("unexpected query: %s", qb.query)
	}
	if len(qb.args) != 0 {
		t.Errorf("expected 0 args, got %v", qb.args)
	}
}

func TestQueryBuilder_Append(t *testing.T) {
	qb := newQueryBuilder("SELECT * FROM t WHERE 1=1")
	qb.AddCondition(" AND x = $%d", "val")
	qb.append(" ORDER BY x DESC")

	expected := "SELECT * FROM t WHERE 1=1 AND x = $1 ORDER BY x DESC"
	if qb.query != expected {
		t.Errorf("unexpected query: %s", qb.query)
	}
	// append should not affect argNum
	if qb.argNum != 2 {
		t.Errorf("expected argNum 2, got %d", qb.argNum)
	}
}
