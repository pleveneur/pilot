// ssh.rs — Helpers SSH purs du GDS (refonte GDS, lot L1)
//
// Première brique du futur `gds-core/src/ssh.rs` (L1.6) : la couche base
// (`gds_core::db`) a besoin de l'empreinte d'une clef publique pour retrouver
// une clef par empreinte SHA256 (`get_ssh_key_by_fingerprint`). La fonction
// (pure, testable) est donc déplacée ici avec son test, en attendant que le
// reste des helpers SSH serveur la rejoignent.

/// Empreinte SHA256 d'une clef publique (convention `ssh-keygen -lf` :
/// SHA256 du blob base64 décodé, encodé en base64). Pure — testable.
pub fn public_key_fingerprint(public_key: &str) -> String {
    use base64::Engine;
    use sha2::{Digest, Sha256};
    let parts: Vec<&str> = public_key.split_whitespace().collect();
    if parts.len() < 2 {
        return String::new();
    }
    let decoded = base64::engine::general_purpose::STANDARD
        .decode(parts[1])
        .unwrap_or_default();
    let mut hasher = Sha256::new();
    hasher.update(&decoded);
    let digest = hasher.finalize();
    let fp = base64::engine::general_purpose::STANDARD.encode(digest);
    format!("SHA256:{}", fp)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn public_key_fingerprint_is_deterministic() {
        let k = "ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAIExampleKey==";
        let fp1 = public_key_fingerprint(k);
        let fp2 = public_key_fingerprint(k);
        assert!(!fp1.is_empty());
        assert_eq!(fp1, fp2);
        assert!(fp1.starts_with("SHA256:"));
        // Clef invalide → empreinte vide.
        assert_eq!(public_key_fingerprint("bogus"), "");
    }
}
