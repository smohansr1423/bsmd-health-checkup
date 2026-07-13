// Family accounts with capacity and role isolation (Task 4.6).
//
// Implements the User & Profile Service family-account rules from Requirement
// 19 and the `POST /family/members` endpoint from the design ("User & Profile
// Service" endpoint list):
//
//   - Up to 5 isolated member profiles per family account (Req 19.1); adds
//     beyond 5 are rejected leaving existing profiles unchanged (Req 19.2).
//   - Each member's health data is isolated: it is not readable or modifiable
//     from any other member profile (Req 19.3). A non-admin member that tries
//     to read/modify another member's health data is denied with an
//     insufficient-permissions error and the target is left unchanged
//     (Req 19.4).
//   - An admin may add, view, edit, or remove a member profile (Req 19.5); a
//     non-admin that attempts to add/edit/remove is denied with an
//     insufficient-permissions error and the affected profiles are left
//     unchanged (Req 19.6).
//
// This file is additive and self-contained within package main. The family
// domain types mirror the shared Go contract (shared/go/domain.go:
// FamilyAccount / MemberProfile / FamilyRole) and the in-memory store mirrors
// the persistence invariants encoded in migration 000006_create_family_accounts
// (member_slot in 1..5 unique per account => at most 5 members; exactly one
// admin member per account). Degraded outcomes use the shared error/result
// contract from result.go.
//
// Requirements: 19.1, 19.2, 19.3, 19.4, 19.5, 19.6
package main

import (
	"encoding/json"
	"net/http"
	"sort"
	"sync"
)

// MaxFamilyMembers is the per-family-account member cap (Req 19.1). It mirrors
// the migration's member_slot BETWEEN 1 AND 5 constraint.
const MaxFamilyMembers = 5

// FamilyRole is the role of a member within a family account (Req 19). It
// mirrors the shared contract's FamilyRole and the migration CHECK
// (role IN ('admin','member')).
type FamilyRole string

const (
	// FamilyRoleAdmin may add, view, edit, and remove member profiles and may
	// access any member's health data (Req 19.5).
	FamilyRoleAdmin FamilyRole = "admin"
	// FamilyRoleMember may only access its own health data (Req 19.3, 19.4).
	FamilyRoleMember FamilyRole = "member"
)

// Error codes surfaced by the family service (stable, machine-readable).
const (
	// CodeFamilyCapacityReached indicates the family account already holds the
	// maximum of 5 member profiles (Req 19.2).
	CodeFamilyCapacityReached = "FAMILY_CAPACITY_REACHED"
	// CodeInsufficientPermissions indicates the actor lacks the role required
	// for the requested operation (Req 19.4, 19.6).
	CodeInsufficientPermissions = "INSUFFICIENT_PERMISSIONS"
	// CodeFamilyNotFound indicates the referenced family account does not exist.
	CodeFamilyNotFound = "FAMILY_NOT_FOUND"
	// CodeMemberNotFound indicates the referenced member profile does not exist.
	CodeMemberNotFound = "MEMBER_NOT_FOUND"
	// CodeMemberExists indicates the user already holds a profile in the account.
	CodeMemberExists = "MEMBER_ALREADY_EXISTS"
	// CodeInvalidFamilyRequest indicates a malformed request body/field.
	CodeInvalidFamilyRequest = "INVALID_FAMILY_REQUEST"
)

// FamilyMember is a single member profile within a family account. It mirrors
// the shared MemberProfile plus the isolated per-member health data and the
// persistence slot from migration 000006 (family_members.member_slot).
type FamilyMember struct {
	ID     string     `json:"id"`
	UserID string     `json:"userId"`
	Role   FamilyRole `json:"role"`
	// Slot is the 1..5 member_slot occupied in the family account. Slot
	// uniqueness per account is what bounds membership at 5 (Req 19.1).
	Slot int `json:"slot"`
	// HealthData is the member's isolated health data (Req 19.3). It is only
	// reachable via the store's authorization-checked accessors.
	HealthData map[string]string `json:"-"`
}

// clone returns a deep copy so callers can never mutate stored state directly
// (isolation, Req 19.3/19.4).
func (m FamilyMember) clone() FamilyMember {
	cp := m
	if m.HealthData != nil {
		cp.HealthData = make(map[string]string, len(m.HealthData))
		for k, v := range m.HealthData {
			cp.HealthData[k] = v
		}
	}
	return cp
}

// FamilyAccount is a family account holding <=5 member profiles (Req 19.1). It
// mirrors the shared FamilyAccount contract.
type FamilyAccount struct {
	ID          string         `json:"id"`
	AdminUserID string         `json:"adminUserId"`
	Members     []FamilyMember `json:"members"`
}

// FamilyService is a thread-safe, in-memory family-account store enforcing the
// Requirement-19 rules. It mirrors the migration invariants (<=5 slots, exactly
// one admin) so behaviour matches the eventual PostgreSQL-backed store.
type FamilyService struct {
	mu       sync.Mutex
	accounts map[string]*FamilyAccount
	nextID   int
}

// NewFamilyService constructs an empty family service.
func NewFamilyService() *FamilyService {
	return &FamilyService{accounts: make(map[string]*FamilyAccount)}
}

// CreateAccount creates a family account with the given admin as its first
// member (occupying slot 1, role admin). This establishes the single-admin
// invariant from the migration.
func (s *FamilyService) CreateAccount(adminUserID string) Result[FamilyAccount] {
	s.mu.Lock()
	defer s.mu.Unlock()

	if adminUserID == "" {
		return Fail[FamilyAccount](ValidationRejection(CodeInvalidFamilyRequest, "admin user id is required"))
	}

	acct := &FamilyAccount{
		ID:          s.newID("fam"),
		AdminUserID: adminUserID,
		Members: []FamilyMember{{
			ID:         s.newID("mbr"),
			UserID:     adminUserID,
			Role:       FamilyRoleAdmin,
			Slot:       1,
			HealthData: map[string]string{},
		}},
	}
	s.accounts[acct.ID] = acct
	return Okay(s.snapshot(acct))
}

// AddMember adds a new member profile to the family account. Only the family
// admin may add (Req 19.5/19.6). Adds beyond 5 members are rejected leaving the
// existing profiles unchanged (Req 19.1/19.2).
func (s *FamilyService) AddMember(accountID, actorUserID, newUserID string, role FamilyRole) Result[FamilyMember] {
	s.mu.Lock()
	defer s.mu.Unlock()

	acct, err := s.requireAccount(accountID)
	if err != nil {
		return Fail[FamilyMember](*err)
	}
	// Admin-only add (Req 19.6): deny non-admins, leaving profiles unchanged.
	if !s.isAdmin(acct, actorUserID) {
		return Fail[FamilyMember](ValidationRejection(CodeInsufficientPermissions,
			"only the family admin may add member profiles"))
	}
	if newUserID == "" {
		return Fail[FamilyMember](ValidationRejection(CodeInvalidFamilyRequest, "new member user id is required"))
	}
	if role != FamilyRoleAdmin && role != FamilyRoleMember {
		return Fail[FamilyMember](ValidationRejection(CodeInvalidFamilyRequest, "role must be 'admin' or 'member'"))
	}
	// A profile joins an account at most once (migration UNIQUE constraint).
	for _, m := range acct.Members {
		if m.UserID == newUserID {
			return Fail[FamilyMember](ValidationRejection(CodeMemberExists,
				"this user already has a profile in the family account"))
		}
	}
	// Capacity: reject the 6th add, retaining existing profiles unchanged
	// (Req 19.2). Enforced by exhausting the 1..5 slot space.
	slot, ok := s.freeSlot(acct)
	if !ok {
		return Fail[FamilyMember](ValidationRejection(CodeFamilyCapacityReached,
			"the maximum of 5 member profiles has been reached"))
	}

	member := FamilyMember{
		ID:         s.newID("mbr"),
		UserID:     newUserID,
		Role:       role,
		Slot:       slot,
		HealthData: map[string]string{},
	}
	acct.Members = append(acct.Members, member)
	return Okay(member.clone())
}

// EditMemberRole changes a member profile's role. Admin-only (Req 19.5/19.6);
// non-admin attempts are denied and leave the affected profiles unchanged.
func (s *FamilyService) EditMemberRole(accountID, actorUserID, targetMemberID string, role FamilyRole) Result[FamilyMember] {
	s.mu.Lock()
	defer s.mu.Unlock()

	acct, err := s.requireAccount(accountID)
	if err != nil {
		return Fail[FamilyMember](*err)
	}
	if !s.isAdmin(acct, actorUserID) {
		return Fail[FamilyMember](ValidationRejection(CodeInsufficientPermissions,
			"only the family admin may edit member profiles"))
	}
	if role != FamilyRoleAdmin && role != FamilyRoleMember {
		return Fail[FamilyMember](ValidationRejection(CodeInvalidFamilyRequest, "role must be 'admin' or 'member'"))
	}
	idx := s.indexOfMember(acct, targetMemberID)
	if idx < 0 {
		return Fail[FamilyMember](ValidationRejection(CodeMemberNotFound, "member profile not found"))
	}
	// The account must always retain an admin: demoting the sole admin to a
	// non-admin role is rejected, leaving the affected profiles unchanged
	// (preserving the single-admin migration invariant, mirroring RemoveMember).
	if acct.Members[idx].Role == FamilyRoleAdmin && role != FamilyRoleAdmin && s.adminCount(acct) == 1 {
		return Fail[FamilyMember](ValidationRejection(CodeInsufficientPermissions,
			"the family account must retain an admin"))
	}
	acct.Members[idx].Role = role
	return Okay(acct.Members[idx].clone())
}

// RemoveMember removes a member profile. Admin-only (Req 19.5/19.6); non-admin
// attempts are denied and leave the affected profiles unchanged. The account's
// sole admin cannot be removed (preserving the single-admin migration invariant).
func (s *FamilyService) RemoveMember(accountID, actorUserID, targetMemberID string) Result[FamilyAccount] {
	s.mu.Lock()
	defer s.mu.Unlock()

	acct, err := s.requireAccount(accountID)
	if err != nil {
		return Fail[FamilyAccount](*err)
	}
	if !s.isAdmin(acct, actorUserID) {
		return Fail[FamilyAccount](ValidationRejection(CodeInsufficientPermissions,
			"only the family admin may remove member profiles"))
	}
	idx := s.indexOfMember(acct, targetMemberID)
	if idx < 0 {
		return Fail[FamilyAccount](ValidationRejection(CodeMemberNotFound, "member profile not found"))
	}
	if acct.Members[idx].Role == FamilyRoleAdmin && s.adminCount(acct) == 1 {
		return Fail[FamilyAccount](ValidationRejection(CodeInsufficientPermissions,
			"the family account must retain an admin"))
	}
	acct.Members = append(acct.Members[:idx], acct.Members[idx+1:]...)
	return Okay(s.snapshot(acct))
}

// ReadHealthData returns a copy of a member's health data. A member may read its
// own data; reading another member's data requires the admin role (Req 19.3).
// A non-admin reading another member's data is denied with an
// insufficient-permissions error and the target is left unchanged (Req 19.4).
func (s *FamilyService) ReadHealthData(accountID, actorUserID, targetMemberID string) Result[map[string]string] {
	s.mu.Lock()
	defer s.mu.Unlock()

	acct, err := s.requireAccount(accountID)
	if err != nil {
		return Fail[map[string]string](*err)
	}
	idx := s.indexOfMember(acct, targetMemberID)
	if idx < 0 {
		return Fail[map[string]string](ValidationRejection(CodeMemberNotFound, "member profile not found"))
	}
	if e := s.authorizeHealthAccess(acct, actorUserID, acct.Members[idx].UserID); e != nil {
		return Fail[map[string]string](*e)
	}
	return Okay(acct.Members[idx].clone().HealthData)
}

// WriteHealthData sets a key in a member's isolated health data. A member may
// modify its own data; modifying another member's data requires the admin role
// (Req 19.3). A non-admin modifying another member's data is denied and the
// target's health data is left unchanged (Req 19.4).
func (s *FamilyService) WriteHealthData(accountID, actorUserID, targetMemberID, key, value string) Result[map[string]string] {
	s.mu.Lock()
	defer s.mu.Unlock()

	acct, err := s.requireAccount(accountID)
	if err != nil {
		return Fail[map[string]string](*err)
	}
	idx := s.indexOfMember(acct, targetMemberID)
	if idx < 0 {
		return Fail[map[string]string](ValidationRejection(CodeMemberNotFound, "member profile not found"))
	}
	if e := s.authorizeHealthAccess(acct, actorUserID, acct.Members[idx].UserID); e != nil {
		// Deny and leave the target unchanged (Req 19.4).
		return Fail[map[string]string](*e)
	}
	if key == "" {
		return Fail[map[string]string](ValidationRejection(CodeInvalidFamilyRequest, "health-data key is required"))
	}
	if acct.Members[idx].HealthData == nil {
		acct.Members[idx].HealthData = map[string]string{}
	}
	acct.Members[idx].HealthData[key] = value
	return Okay(acct.Members[idx].clone().HealthData)
}

// GetAccount returns a read-only snapshot of the account (admin or any member
// of the account may view the roster; per-member health data is not included).
func (s *FamilyService) GetAccount(accountID string) Result[FamilyAccount] {
	s.mu.Lock()
	defer s.mu.Unlock()
	acct, err := s.requireAccount(accountID)
	if err != nil {
		return Fail[FamilyAccount](*err)
	}
	return Okay(s.snapshot(acct))
}

// ---------------------------------------------------------------------------
// internal helpers (all called with s.mu held)
// ---------------------------------------------------------------------------

func (s *FamilyService) newID(prefix string) string {
	s.nextID++
	// Small, deterministic, dependency-free identifier.
	return prefix + "-" + itoa(s.nextID)
}

func (s *FamilyService) requireAccount(accountID string) (*FamilyAccount, *ErrorContract) {
	acct, ok := s.accounts[accountID]
	if !ok {
		e := ValidationRejection(CodeFamilyNotFound, "family account not found")
		return nil, &e
	}
	return acct, nil
}

func (s *FamilyService) isAdmin(acct *FamilyAccount, userID string) bool {
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

// authorizeHealthAccess allows access when the actor is the owner of the data or
// holds the admin role; otherwise it returns an insufficient-permissions error
// (Req 19.3/19.4). An actor that is not a member of the account is also denied.
func (s *FamilyService) authorizeHealthAccess(acct *FamilyAccount, actorUserID, ownerUserID string) *ErrorContract {
	if actorUserID != "" && actorUserID == ownerUserID {
		return nil // own data
	}
	if s.isAdmin(acct, actorUserID) {
		return nil // admin management access (Req 19.5)
	}
	e := ValidationRejection(CodeInsufficientPermissions,
		"insufficient permissions to access another member's health data")
	return &e
}

func (s *FamilyService) indexOfMember(acct *FamilyAccount, memberID string) int {
	for i, m := range acct.Members {
		if m.ID == memberID {
			return i
		}
	}
	return -1
}

func (s *FamilyService) adminCount(acct *FamilyAccount) int {
	n := 0
	for _, m := range acct.Members {
		if m.Role == FamilyRoleAdmin {
			n++
		}
	}
	return n
}

// freeSlot returns the lowest unused slot in 1..MaxFamilyMembers, or false when
// the account is at capacity (Req 19.1/19.2).
func (s *FamilyService) freeSlot(acct *FamilyAccount) (int, bool) {
	used := make(map[int]bool, len(acct.Members))
	for _, m := range acct.Members {
		used[m.Slot] = true
	}
	for slot := 1; slot <= MaxFamilyMembers; slot++ {
		if !used[slot] {
			return slot, true
		}
	}
	return 0, false
}

// snapshot returns a deep copy of the account with members sorted by slot and
// health data omitted (roster view only).
func (s *FamilyService) snapshot(acct *FamilyAccount) FamilyAccount {
	members := make([]FamilyMember, len(acct.Members))
	for i, m := range acct.Members {
		c := m.clone()
		c.HealthData = nil
		members[i] = c
	}
	sort.Slice(members, func(i, j int) bool { return members[i].Slot < members[j].Slot })
	return FamilyAccount{ID: acct.ID, AdminUserID: acct.AdminUserID, Members: members}
}

// itoa is a tiny base-10 integer formatter avoiding an strconv import churn.
func itoa(n int) string {
	if n == 0 {
		return "0"
	}
	neg := n < 0
	if neg {
		n = -n
	}
	var buf [20]byte
	i := len(buf)
	for n > 0 {
		i--
		buf[i] = byte('0' + n%10)
		n /= 10
	}
	if neg {
		i--
		buf[i] = '-'
	}
	return string(buf[i:])
}

// ---------------------------------------------------------------------------
// HTTP wiring: POST /family/members (additive; register from main in bootstrap)
// ---------------------------------------------------------------------------

// addMemberRequest is the POST /family/members request body.
type addMemberRequest struct {
	FamilyAccountID string     `json:"familyAccountId"`
	ActorUserID     string     `json:"actorUserId"`
	MemberUserID    string     `json:"memberUserId"`
	Role            FamilyRole `json:"role"`
}

// RegisterFamilyRoutes wires the family endpoints onto the provided mux. It is
// additive so the service bootstrap can mount it without other tasks' routes
// conflicting.
func RegisterFamilyRoutes(mux *http.ServeMux, svc *FamilyService) {
	mux.HandleFunc("/family/members", svc.handleAddMember)
}

// handleAddMember implements POST /family/members (Req 19.1/19.2/19.5/19.6).
func (s *FamilyService) handleAddMember(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		writeFamilyError(w, http.StatusMethodNotAllowed,
			ValidationRejection(CodeInvalidFamilyRequest, "method not allowed"))
		return
	}
	var req addMemberRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		writeFamilyError(w, http.StatusBadRequest,
			ValidationRejection(CodeInvalidFamilyRequest, "invalid request body"))
		return
	}
	if req.Role == "" {
		req.Role = FamilyRoleMember
	}

	res := s.AddMember(req.FamilyAccountID, req.ActorUserID, req.MemberUserID, req.Role)
	if !res.Ok {
		writeFamilyError(w, familyErrorStatus(res.Error.Code), *res.Error)
		return
	}
	writeFamilyJSON(w, http.StatusCreated, res.Value)
}

// familyErrorStatus maps an error code to an HTTP status.
func familyErrorStatus(code string) int {
	switch code {
	case CodeInsufficientPermissions:
		return http.StatusForbidden
	case CodeFamilyCapacityReached, CodeMemberExists:
		return http.StatusConflict
	case CodeFamilyNotFound, CodeMemberNotFound:
		return http.StatusNotFound
	default:
		return http.StatusBadRequest
	}
}

func writeFamilyError(w http.ResponseWriter, status int, e ErrorContract) {
	writeFamilyJSON(w, status, e)
}

func writeFamilyJSON(w http.ResponseWriter, status int, body any) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(status)
	_ = json.NewEncoder(w).Encode(body)
}
