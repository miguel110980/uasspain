//! Authenticated byte deltas for logical PostgreSQL dumps and media archives.
//! Encryption is applied by the caller. This format is not WAL/PITR.
use std::collections::HashMap;

use sha2::{Digest, Sha256};

const MAGIC: &[u8; 8] = b"UASDLT01";
const BLOCK: usize = 1024;
const MAX_BYTES: usize = 64 * 1024 * 1024;
const INVALID: &str = "Delta incremental corrupto o incompatible.";

fn hash(bytes: &[u8]) -> u64 {
    bytes.iter().fold(0_u64, |h, b| {
        h.wrapping_mul(257).wrapping_add(u64::from(*b) + 1)
    })
}

fn number(output: &mut Vec<u8>, value: usize) {
    output.extend_from_slice(&(value as u64).to_le_bytes());
}

fn literal(output: &mut Vec<u8>, bytes: &[u8]) {
    if !bytes.is_empty() {
        output.push(1);
        number(output, bytes.len());
        output.extend_from_slice(bytes);
    }
}

pub(crate) fn encode(base: &[u8], target: &[u8]) -> Result<Vec<u8>, String> {
    if base.len() > MAX_BYTES || target.len() > MAX_BYTES {
        return Err("El delta incremental supera 64 MiB; crea una copia FULL.".into());
    }
    let mut index: HashMap<u64, Vec<usize>> = HashMap::new();
    for (block, bytes) in base.as_chunks::<BLOCK>().0.iter().enumerate() {
        let offsets = index.entry(hash(bytes)).or_default();
        // Bound repeated blocks and hash collisions. Equality is always checked.
        if offsets.len() < 4 {
            offsets.push(block * BLOCK);
        }
    }
    let mut output = MAGIC.to_vec();
    number(&mut output, target.len());
    output.extend_from_slice(&Sha256::digest(base));
    output.extend_from_slice(&Sha256::digest(target));
    let power = (1..BLOCK).fold(1_u64, |p, _| p.wrapping_mul(257));
    let (mut position, mut pending) = (0, 0);
    let mut rolling = target.get(..BLOCK).map(hash);
    while position + BLOCK <= target.len() {
        let key = rolling.unwrap_or_else(|| hash(&target[position..position + BLOCK]));
        let candidate = index.get(&key).and_then(|offsets| {
            offsets
                .iter()
                .copied()
                .find(|offset| base[*offset..*offset + BLOCK] == target[position..position + BLOCK])
        });
        if let Some(offset) = candidate {
            let mut length = BLOCK;
            while offset + length < base.len()
                && position + length < target.len()
                && base[offset + length] == target[position + length]
            {
                length += 1;
            }
            literal(&mut output, &target[pending..position]);
            output.push(0);
            number(&mut output, offset);
            number(&mut output, length);
            position += length;
            pending = position;
            rolling = None;
        } else {
            rolling = target.get(position + BLOCK).map(|incoming| {
                key.wrapping_sub((u64::from(target[position]) + 1).wrapping_mul(power))
                    .wrapping_mul(257)
                    .wrapping_add(u64::from(*incoming) + 1)
            });
            position += 1;
        }
    }
    literal(&mut output, &target[pending..]);
    Ok(output)
}

fn take<'a>(input: &mut &'a [u8], length: usize) -> Result<&'a [u8], String> {
    let bytes = input.get(..length).ok_or(INVALID)?;
    *input = &input[length..];
    Ok(bytes)
}

fn read_number(input: &mut &[u8]) -> Result<usize, String> {
    let bytes = take(input, 8)?;
    usize::try_from(u64::from_le_bytes(bytes.try_into().map_err(|_| INVALID)?))
        .map_err(|_| INVALID.into())
}

pub(crate) fn apply(base: &[u8], mut input: &[u8]) -> Result<Vec<u8>, String> {
    if take(&mut input, MAGIC.len())? != MAGIC {
        return Err(INVALID.into());
    }
    let length = read_number(&mut input)?;
    if length > MAX_BYTES || base.len() > MAX_BYTES {
        return Err(INVALID.into());
    }
    if take(&mut input, 32)? != Sha256::digest(base).as_slice() {
        return Err("Checksum de la base incremental no válido.".into());
    }
    let checksum = take(&mut input, 32)?.to_vec();
    let mut output = Vec::new();
    while !input.is_empty() {
        let tag = take(&mut input, 1)?[0];
        let bytes = match tag {
            0 => {
                let offset = read_number(&mut input)?;
                let size = read_number(&mut input)?;
                base.get(offset..offset.checked_add(size).ok_or(INVALID)?)
                    .ok_or(INVALID)?
            }
            1 => {
                let size = read_number(&mut input)?;
                take(&mut input, size)?
            }
            _ => return Err(INVALID.into()),
        };
        if bytes.is_empty()
            || output
                .len()
                .checked_add(bytes.len())
                .is_none_or(|n| n > length)
        {
            return Err(INVALID.into());
        }
        output.extend_from_slice(bytes);
    }
    if output.len() != length || Sha256::digest(&output).as_slice() != checksum {
        return Err("Checksum del estado incremental reconstruido no válido.".into());
    }
    Ok(output)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn changes_insertions_deletions_and_reordering_reconstruct_exactly() {
        let base: Vec<u8> = (0..24000)
            .map(|i| ((i * 17 + i / 31) % 251) as u8)
            .collect();
        let mut target = b"inserted".to_vec();
        target.extend_from_slice(&base[8000..16000]);
        target.extend_from_slice(b"changed");
        target.extend_from_slice(&base[..4000]);
        target.extend_from_slice(&base[17000..]);
        let delta = encode(&base, &target).unwrap();
        assert!(delta.len() < target.len() / 2);
        assert_eq!(apply(&base, &delta).unwrap(), target);
        let next = [target.as_slice(), b"next point"].concat();
        assert_eq!(
            apply(&target, &encode(&target, &next).unwrap()).unwrap(),
            next
        );
    }

    #[test]
    fn empty_small_and_unrelated_archives_work() {
        for (base, target) in [
            (b"".as_slice(), b"".as_slice()),
            (b"old", b"new"),
            (b"base", b""),
        ] {
            assert_eq!(apply(base, &encode(base, target).unwrap()).unwrap(), target);
        }
    }

    #[test]
    fn rejects_corruption_wrong_base_truncation_and_unbounded_output() {
        let base = vec![9; 4096];
        let delta = encode(&base, &base).unwrap();
        assert!(apply(&vec![8; 4096], &delta).is_err());
        for size in 0..delta.len() {
            assert!(apply(&base, &delta[..size]).is_err());
        }
        let mut corrupt = delta.clone();
        corrupt[48] ^= 1;
        assert!(apply(&base, &corrupt).is_err());
        let mut excessive = delta.clone();
        excessive[8..16].copy_from_slice(&u64::MAX.to_le_bytes());
        assert!(apply(&base, &excessive).is_err());
        let mut bounds = delta;
        bounds[81..89].copy_from_slice(&u64::MAX.to_le_bytes());
        assert!(apply(&base, &bounds).is_err());
    }
}
