// Focused unit tests for family accounts with capacity and role isolation
// (Task 4.6). The exhaustive Property 46 test is a separate optional task (4.7).
//
// Requirements: 19.1, 19.2, 19.3, 19.4, 19.5, 19.6
package main

import (
	"bytes"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
)

// newAccountWithAdmin creates an account and returns the service, account id,
// and the admin's user id.
func newAccountWithAdmin(t *testing.T) (*FamilyService, string, string) {
	t.Helper()
	svc := NewFamilyService()
	res := svc.CreateAccount("admin-user")
	if !res.Ok {
		t.Fatalf("CreateAccount failed: %+v", res.Error)
	}
	return svc, res.Value.ID, "admin-user"
}

// Req 19.1/19.5: admin can add up to the cap; slots fill 1..5.
func TestAdminCanAddUpToCapacity(t *testing.T) {
	svc, acct, admin := newAccountWithAdmin(t)

	// Admin already occupies slot 1, so 4 more members reach the cap of 5.
	for i := 0; i < 4; i++ {
		res := svc.AddMember(acct, admin, "member-"+itoa(i), FamilyRoleMember)
		if !res.Ok {
			t.Fatalf("add %d failed: %+v", i, res.Error)
		}
	}
	got := svc.GetAccount(acct)
	if !got.Ok || len(got.Value.Members) != MaxFamilyMembers {
		t.Fatalf("expected %d members, got %+v", MaxFamilyMembers, got.Value.Members)
	}
	// Slots must be unique and within 1..5.
	seen := map[int]bool{}
	for _, m := range got.Value.Members {
		if m.Slot < 1 || m.Slot > MaxFamilyMembers || seen[m.Slot] {
			t.Fatalf("invalid/duplicate slot %d in %+v", m.Slot, got.Value.Members)
		}
		seen[m.Slot] = true
	}
}

// Req 19.2: adding beyond 5 is rejected and existing profiles are unchanged.
func TestAddBeyondCapacityRejectedAndUnchanged(t *testing.T) {
	svc, acct, admin := newAccountWithAdmin(t)
	for i := 0; i < 4; i++ {
		if res := svc.AddMember(acct, admin, "member-"+itoa(i), FamilyRoleMember); !res.Ok {
			t.Fatalf("setup add %d failed: %+v", i, res.Error)
		}
	}
	before := svc.GetAccount(acct).Value

	res := svc.AddMember(acct, admin, "member-overflow", FamilyRoleMember)
	if res.Ok {
		t.Fatalf("expected 6th add to be rejected")
	}
	if res.Error.Code != CodeFamilyCapacityReached {
		t.Fatalf("expected %s, got %s", CodeFamilyCapacityReached, res.Error.Code)
	}
	if !res.Error.RetainedState {
		t.Fatalf("capacity rejection must retain state")
	}
	after := svc.GetAccount(acct).Value
	if len(after.Members) != len(before.Members) {
		t.Fatalf("existing profiles changed: before=%d after=%d", len(before.Members), len(after.Members))
	}
}

// Req 19.6: a non-admin cannot add/edit/remove; affected profiles unchanged.
func TestNonAdminCannotManageMembers(t *testing.T) {
	svc, acct, admin := newAccountWithAdmin(t)
	added := svc.AddMember(acct, admin, "regular-member", FamilyRoleMember)
	if !added.Ok {
		t.Fatalf("setup add failed: %+v", added.Error)
	}
	beforeCount := len(svc.GetAccount(acct).Value.Members)

	// non-admin add
	if res := svc.AddMember(acct, "regular-member", "new-guy", FamilyRoleMember); res.Ok ||
		res.Error.Code != CodeInsufficientPermissions {
		t.Fatalf("expected insufficient-permissions on non-admin add, got %+v", res)
	}
	// non-admin edit
	if res := svc.EditMemberRole(acct, "regular-member", added.Value.ID, FamilyRoleAdmin); res.Ok ||
		res.Error.Code != CodeInsufficientPermissions {
		t.Fatalf("expected insufficient-permissions on non-admin edit, got %+v", res)
	}
	// non-admin remove
	if res := svc.RemoveMember(acct, "regular-member", added.Value.ID); res.Ok ||
		res.Error.Code != CodeInsufficientPermissions {
		t.Fatalf("expected insufficient-permissions on non-admin remove, got %+v", res)
	}

	after := svc.GetAccount(acct).Value
	if len(after.Members) != beforeCount {
		t.Fatalf("member set changed after denied ops: before=%d after=%d", beforeCount, len(after.Members))
	}
	// role must be unchanged
	for _, m := range after.Members {
		if m.ID == added.Value.ID && m.Role != FamilyRoleMember {
			t.Fatalf("target role changed by denied edit: %+v", m)
		}
	}
}

// Req 19.5: admin can edit and remove member profiles.
func TestAdminCanEditAndRemove(t *testing.T) {
	svc, acct, admin := newAccountWithAdmin(t)
	added := svc.AddMember(acct, admin, "regular-member", FamilyRoleMember)
	if !added.Ok {
		t.Fatalf("setup add failed: %+v", added.Error)
	}
	if res := svc.EditMemberRole(acct, admin, added.Value.ID, FamilyRoleAdmin); !res.Ok ||
		res.Value.Role != FamilyRoleAdmin {
		t.Fatalf("expected admin edit to succeed, got %+v", res)
	}
	if res := svc.RemoveMember(acct, admin, added.Value.ID); !res.Ok {
		t.Fatalf("expected admin remove to succeed, got %+v", res.Error)
	}
	if len(svc.GetAccount(acct).Value.Members) != 1 {
		t.Fatalf("expected only the admin to remain")
	}
}

// Req 19.3/19.4: a non-admin member cannot read/modify another member's health
// data; the target's data is left unchanged.
func TestCrossProfileHealthDataIsolation(t *testing.T) {
	svc, acct, admin := newAccountWithAdmin(t)
	a := svc.AddMember(acct, admin, "alice", FamilyRoleMember)
	b := svc.AddMember(acct, admin, "bob", FamilyRoleMember)
	if !a.Ok || !b.Ok {
		t.Fatalf("setup adds failed: %+v %+v", a.Error, b.Error)
	}

	// Alice writes her own data (allowed).
	if res := svc.WriteHealthData(acct, "alice", a.Value.ID, "weightKg", "70"); !res.Ok {
		t.Fatalf("owner write should succeed, got %+v", res.Error)
	}
	// Bob (non-admin) tries to read Alice's data -> denied.
	if res := svc.ReadHealthData(acct, "bob", a.Value.ID); res.Ok ||
		res.Error.Code != CodeInsufficientPermissions {
		t.Fatalf("expected cross-profile read denied, got %+v", res)
	}
	// Bob (non-admin) tries to modify Alice's data -> denied, unchanged.
	if res := svc.WriteHealthData(acct, "bob", a.Value.ID, "weightKg", "999"); res.Ok ||
		res.Error.Code != CodeInsufficientPermissions {
		t.Fatalf("expected cross-profile write denied, got %+v", res)
	}
	// Confirm (via the admin) the denied write left Alice's data unchanged.
	if adminView := svc.ReadHealthData(acct, admin, a.Value.ID); !adminView.Ok ||
		adminView.Value["weightKg"] != "70" {
		t.Fatalf("target health data was modified by a denied write: %+v", adminView)
	}
	// Alice can still read her own data.
	if r := svc.ReadHealthData(acct, "alice", a.Value.ID); !r.Ok || r.Value["weightKg"] != "70" {
		t.Fatalf("owner read failed or wrong value: %+v", r)
	}
}

// Req 19.5: an admin may read and modify any member's health data (management).
func TestAdminCanAccessMemberHealthData(t *testing.T) {
	svc, acct, admin := newAccountWithAdmin(t)
	a := svc.AddMember(acct, admin, "alice", FamilyRoleMember)
	if !a.Ok {
		t.Fatalf("setup add failed: %+v", a.Error)
	}
	if res := svc.WriteHealthData(acct, admin, a.Value.ID, "restingHR", "60"); !res.Ok {
		t.Fatalf("admin write should succeed, got %+v", res.Error)
	}
	if res := svc.ReadHealthData(acct, admin, a.Value.ID); !res.Ok || res.Value["restingHR"] != "60" {
		t.Fatalf("admin read should succeed with value, got %+v", res)
	}
}

// POST /family/members happy path (admin) returns 201.
func TestHandleAddMemberHTTP_AdminSucceeds(t *testing.T) {
	svc, acct, admin := newAccountWithAdmin(t)
	body, _ := json.Marshal(addMemberRequest{
		FamilyAccountID: acct, ActorUserID: admin, MemberUserID: "child-1", Role: FamilyRoleMember,
	})
	req := httptest.NewRequest(http.MethodPost, "/family/members", bytes.NewReader(body))
	rec := httptest.NewRecorder()
	svc.handleAddMember(rec, req)

	if rec.Code != http.StatusCreated {
		t.Fatalf("expected 201, got %d body=%s", rec.Code, rec.Body.String())
	}
	var m FamilyMember
	if err := json.Unmarshal(rec.Body.Bytes(), &m); err != nil {
		t.Fatalf("decode response: %v", err)
	}
	if m.UserID != "child-1" || m.Role != FamilyRoleMember {
		t.Fatalf("unexpected member in response: %+v", m)
	}
}

// POST /family/members by a non-admin returns 403 with insufficient-permissions.
func TestHandleAddMemberHTTP_NonAdminForbidden(t *testing.T) {
	svc, acct, admin := newAccountWithAdmin(t)
	if res := svc.AddMember(acct, admin, "regular-member", FamilyRoleMember); !res.Ok {
		t.Fatalf("setup add failed: %+v", res.Error)
	}
	body, _ := json.Marshal(addMemberRequest{
		FamilyAccountID: acct, ActorUserID: "regular-member", MemberUserID: "sneaky", Role: FamilyRoleMember,
	})
	req := httptest.NewRequest(http.MethodPost, "/family/members", bytes.NewReader(body))
	rec := httptest.NewRecorder()
	svc.handleAddMember(rec, req)

	if rec.Code != http.StatusForbidden {
		t.Fatalf("expected 403, got %d body=%s", rec.Code, rec.Body.String())
	}
	if !strings.Contains(rec.Body.String(), CodeInsufficientPermissions) {
		t.Fatalf("expected %s in body, got %s", CodeInsufficientPermissions, rec.Body.String())
	}
}
