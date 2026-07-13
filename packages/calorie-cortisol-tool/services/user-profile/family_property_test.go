// Property-based test for family capacity and role isolation (Task 4.7).
//
// Tag: Feature: calorie-cortisol-tool, Property 46
//
// Property 46 (Family capacity and isolation):
//
//	For any family account, the member count never exceeds 5 (adds beyond 5 are
//	rejected leaving existing profiles unchanged), and one member's health data
//	is never readable or modifiable from another profile; only an admin may
//	add/edit/remove member profiles.
//
// The test drives a fresh FamilyService with a generated sequence of arbitrary
// operations (add/edit/remove/read/write by arbitrary actors) and asserts the
// Property-46 invariants hold after *every* step, for >=100 generated sequences.
//
// Validates: Requirements 19.1, 19.2, 19.3, 19.4, 19.5, 19.6
package main

import (
	"reflect"
	"sort"
	"testing"

	"github.com/leanovate/gopter"
	"github.com/leanovate/gopter/gen"
	"github.com/leanovate/gopter/prop"
)

// familyOp is a single generated operation against the family service.
//
//	Kind:   0=add, 1=edit-role, 2=remove, 3=read-health, 4=write-health
//	Actor:  index into the fixed user-id pool acting as the request actor
//	Target: index used to select the new user (add) or an existing member
//	Val:    payload used to derive a health-data value / edited role
type familyOp struct {
	Kind   int
	Actor  int
	Target int
	Val    int
}

// userPool is the fixed set of user ids that may appear as actors or members.
// index 0 ("u0") is the founding admin; the rest are potential members or
// strangers (actors that are not members of the account at all).
const userPoolSize = 8

func userID(i int) string {
	return "u" + itoa(((i%userPoolSize)+userPoolSize)%userPoolSize)
}

// rosterFingerprint is an order-independent snapshot of the member roster used
// to detect any change caused by a *denied* operation (state must be retained).
type rosterFingerprint struct {
	ids   []string
	roles map[string]FamilyRole
	slots map[string]int
	users map[string]string
}

func fingerprint(acct FamilyAccount) rosterFingerprint {
	fp := rosterFingerprint{
		roles: map[string]FamilyRole{},
		slots: map[string]int{},
		users: map[string]string{},
	}
	for _, m := range acct.Members {
		fp.ids = append(fp.ids, m.ID)
		fp.roles[m.ID] = m.Role
		fp.slots[m.ID] = m.Slot
		fp.users[m.ID] = m.UserID
	}
	sort.Strings(fp.ids)
	return fp
}

func rostersEqual(a, b rosterFingerprint) bool {
	if len(a.ids) != len(b.ids) {
		return false
	}
	for i := range a.ids {
		if a.ids[i] != b.ids[i] {
			return false
		}
	}
	for id, role := range a.roles {
		if b.roles[id] != role || a.slots[id] != b.slots[id] || a.users[id] != b.users[id] {
			return false
		}
	}
	return true
}

// TestProperty46FamilyCapacityAndIsolation is the gopter property for
// Property 46. Tag: Feature: calorie-cortisol-tool, Property 46.
func TestProperty46FamilyCapacityAndIsolation(t *testing.T) {
	parameters := gopter.DefaultTestParameters()
	parameters.MinSuccessfulTests = 100 // Property 46 requires >=100 iterations

	properties := gopter.NewProperties(parameters)

	opGen := gen.Struct(reflect.TypeOf(familyOp{}), map[string]gopter.Gen{
		"Kind":   gen.IntRange(0, 4),
		"Actor":  gen.IntRange(0, userPoolSize-1),
		"Target": gen.IntRange(0, userPoolSize-1),
		"Val":    gen.IntRange(0, 1000),
	})

	properties.Property(
		"Feature: calorie-cortisol-tool, Property 46 - capacity <=5 and role/health isolation hold after every operation",
		prop.ForAll(
			func(ops []familyOp) bool {
				svc := NewFamilyService()
				created := svc.CreateAccount(userID(0)) // u0 is the founding admin.
				if !created.Ok {
					return false
				}
				acctID := created.Value.ID

				for _, op := range ops {
					before := svc.GetAccount(acctID).Value
					beforeFP := fingerprint(before)
					actor := userID(op.Actor)
					actorIsAdmin := isAdminUser(before, actor)

					switch op.Kind {
					case 0: // AddMember
						newUser := userID(op.Target)
						role := FamilyRoleMember
						if op.Val%2 == 0 {
							role = FamilyRoleAdmin
						}
						res := svc.AddMember(acctID, actor, newUser, role)
						if !checkAdminOnlyManage(res.Ok, res.Error, actorIsAdmin, beforeFP, svc, acctID) {
							return false
						}
						// Capacity: an add may only succeed if there was room.
						if res.Ok && len(beforeFP.ids) >= MaxFamilyMembers {
							return false
						}
						// A capacity rejection must retain the prior roster.
						if !res.Ok && res.Error.Code == CodeFamilyCapacityReached {
							if !res.Error.RetainedState || !rostersEqual(beforeFP, fingerprint(svc.GetAccount(acctID).Value)) {
								return false
							}
						}

					case 1: // EditMemberRole
						target := selectMemberID(before, op.Target)
						role := FamilyRoleMember
						if op.Val%2 == 0 {
							role = FamilyRoleAdmin
						}
						res := svc.EditMemberRole(acctID, actor, target, role)
						if !checkAdminOnlyManage(res.Ok, res.Error, actorIsAdmin, beforeFP, svc, acctID) {
							return false
						}

					case 2: // RemoveMember
						target := selectMemberID(before, op.Target)
						res := svc.RemoveMember(acctID, actor, target)
						if !checkAdminOnlyManage(res.Ok, res.Error, actorIsAdmin, beforeFP, svc, acctID) {
							return false
						}

					case 3: // ReadHealthData
						target := selectMemberID(before, op.Target)
						ownerUser := ownerOfMember(before, target)
						res := svc.ReadHealthData(acctID, actor, target)
						if !checkHealthIsolation(res.Ok, res.Error, actor, ownerUser, actorIsAdmin) {
							return false
						}

					case 4: // WriteHealthData
						target := selectMemberID(before, op.Target)
						ownerUser := ownerOfMember(before, target)
						key := "k" + itoa(op.Val%4)
						value := "v" + itoa(op.Val)
						// capture target's stored data before the write.
						var storedBefore map[string]string
						if adminRead := svc.ReadHealthData(acctID, userID(0), target); adminRead.Ok {
							storedBefore = adminRead.Value
						}
						res := svc.WriteHealthData(acctID, actor, target, key, value)
						if !checkHealthIsolation(res.Ok, res.Error, actor, ownerUser, actorIsAdmin) {
							return false
						}
						// A denied cross-profile write must leave the target unchanged.
						if !res.Ok && res.Error.Code == CodeInsufficientPermissions {
							if adminRead := svc.ReadHealthData(acctID, userID(0), target); adminRead.Ok {
								if !mapsEqual(storedBefore, adminRead.Value) {
									return false
								}
							}
						}
					}

					// Global invariants that must hold after EVERY operation.
					after := svc.GetAccount(acctID).Value
					if !capacityAndSlotInvariant(after) {
						return false
					}
					if adminCountOf(after) < 1 {
						return false // account must always retain an admin.
					}
				}
				return true
			},
			gen.SliceOf(opGen),
		),
	)

	properties.TestingRun(t)
}

// checkAdminOnlyManage verifies the admin-only rule for add/edit/remove
// (Req 19.5/19.6): a non-admin actor must be denied with insufficient
// permissions and the roster must be left unchanged.
func checkAdminOnlyManage(ok bool, e *ErrorContract, actorIsAdmin bool, beforeFP rosterFingerprint, svc *FamilyService, acctID string) bool {
	if actorIsAdmin {
		return true // admin operations are governed by other invariants.
	}
	if ok {
		return false // a non-admin must never succeed at a management op.
	}
	if e == nil || e.Code != CodeInsufficientPermissions {
		return false
	}
	// Roster must be unchanged after a denied management op.
	return rostersEqual(beforeFP, fingerprint(svc.GetAccount(acctID).Value))
}

// checkHealthIsolation verifies cross-profile health-data isolation
// (Req 19.3/19.4): an actor that is neither the owner nor an admin must be
// denied with insufficient permissions.
func checkHealthIsolation(ok bool, e *ErrorContract, actor, ownerUser string, actorIsAdmin bool) bool {
	authorized := actorIsAdmin || (ownerUser != "" && actor == ownerUser)
	if authorized {
		return true
	}
	// Unauthorized: must fail. A missing member (empty owner) fails with a
	// not-found code, which is also acceptable (no cross-profile access).
	if ok {
		return false
	}
	if e == nil {
		return false
	}
	if ownerUser == "" {
		return e.Code == CodeMemberNotFound
	}
	return e.Code == CodeInsufficientPermissions
}

// capacityAndSlotInvariant asserts the member count never exceeds 5 and slots
// are unique within 1..5 (Req 19.1/19.2).
func capacityAndSlotInvariant(acct FamilyAccount) bool {
	if len(acct.Members) > MaxFamilyMembers {
		return false
	}
	seen := map[int]bool{}
	for _, m := range acct.Members {
		if m.Slot < 1 || m.Slot > MaxFamilyMembers || seen[m.Slot] {
			return false
		}
		seen[m.Slot] = true
	}
	return true
}

func adminCountOf(acct FamilyAccount) int {
	n := 0
	for _, m := range acct.Members {
		if m.Role == FamilyRoleAdmin {
			n++
		}
	}
	return n
}

func isAdminUser(acct FamilyAccount, userID string) bool {
	if userID == "" {
		return false
	}
	for _, m := range acct.Members {
		if m.UserID == userID {
			return m.Role == FamilyRoleAdmin
		}
	}
	return false
}

// selectMemberID picks an existing member's ID by index, or "" when the roster
// is empty (never, since the admin always remains).
func selectMemberID(acct FamilyAccount, sel int) string {
	if len(acct.Members) == 0 {
		return ""
	}
	idx := ((sel % len(acct.Members)) + len(acct.Members)) % len(acct.Members)
	return acct.Members[idx].ID
}

func ownerOfMember(acct FamilyAccount, memberID string) string {
	for _, m := range acct.Members {
		if m.ID == memberID {
			return m.UserID
		}
	}
	return ""
}

func mapsEqual(a, b map[string]string) bool {
	if len(a) != len(b) {
		return false
	}
	for k, v := range a {
		if b[k] != v {
			return false
		}
	}
	return true
}
