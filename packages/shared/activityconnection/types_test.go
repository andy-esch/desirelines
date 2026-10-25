package activityconnection

import (
	"encoding/json"
	"os"
	"path/filepath"
	"reflect"
	"runtime"
	"strings"
	"testing"
)

func TestRecordContract(t *testing.T) {
	_, file, _, _ := runtime.Caller(0)
	data, err := os.ReadFile(filepath.Join(filepath.Dir(file), "..", "..", "..", "schemas", "test-fixtures", "activity_connection.json"))
	if err != nil {
		t.Fatal(err)
	}
	var r Record
	if err = json.Unmarshal(data, &r); err != nil {
		t.Fatal(err)
	}
	if err = r.Validate(); err != nil {
		t.Fatal(err)
	}
	if r.UID == r.Subject || r.Scopes[0] != "activity:read_all" {
		t.Fatal("fixture must exercise independent ownership and non-default scopes")
	}
	var fields map[string]any
	if err = json.Unmarshal(data, &fields); err != nil {
		t.Fatal(err)
	}
	typ := reflect.TypeOf(r)
	if len(fields) != typ.NumField() {
		t.Fatal("fixture/schema field drift")
	}
	for i := 0; i < typ.NumField(); i++ {
		if _, ok := fields[typ.Field(i).Tag.Get("firestore")]; !ok {
			t.Fatalf("missing field %s", typ.Field(i).Name)
		}
	}
	for _, subject := range []string{"", "0", "-1", "+1", "001", "1/2", "9223372036854775808"} {
		if _, keyErr := LookupKey(subject); keyErr == nil {
			t.Errorf("accepted invalid subject %q", subject)
		}
	}
	for _, uid := range []string{"", "../user", ".", "..", strings.Repeat("x", 129), "a\nb"} {
		r.UID = uid
		if validationErr := r.Validate(); validationErr == nil {
			t.Errorf("accepted invalid UID %q", uid)
		}
	}
}
