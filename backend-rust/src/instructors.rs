//! Instructor assignment and role-scoped query domain.
pub fn may_manage_student(role: &str, assigned: bool) -> bool {
    role == "admin" || (role == "instructor" && assigned)
}
