fn main() {
    // SQLx embeds migrations in the executable. Cargo must notice newly added
    // files even when Rust sources and the persistent Docker target cache stay
    // unchanged; otherwise a rebuilt image can silently ship an old migrator.
    println!("cargo:rerun-if-changed=migrations");
}
