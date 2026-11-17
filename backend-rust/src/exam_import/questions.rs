use super::{Line, Question, option_line, question_start};
use serde_json::{Value, json};
use std::collections::{BTreeMap, BTreeSet};

#[derive(Default)]
struct Evidence {
    visible: usize,
    bold: usize,
    colors: BTreeMap<String, usize>,
    tick: bool,
}
impl Evidence {
    fn add(&mut self, line: &Line, text: &str, tick: bool) {
        let count = text.chars().filter(|c| !c.is_whitespace()).count();
        self.visible += count;
        if line.bold {
            self.bold += count;
        }
        *self
            .colors
            .entry(line.color.clone().unwrap_or_else(|| "000000".into()))
            .or_default() += count;
        self.tick |= tick;
    }
    fn color(&self) -> Option<String> {
        self.colors
            .iter()
            .find(|(_, count)| **count * 5 >= self.visible * 4)
            .map(|(color, _)| color.clone())
    }
}
struct Pending {
    number: usize,
    statement: String,
    options: BTreeMap<char, String>,
    styles: BTreeMap<char, Evidence>,
    last: Option<char>,
    duplicate: bool,
}
fn tick(c: char) -> bool {
    matches!(c, '✓' | '✔' | '✅' | '\u{fe0f}' | '\u{fe0e}')
}
fn trim_tick(text: &str) -> (&str, bool) {
    let original = text.trim();
    let cleaned = original.trim_matches(|c: char| c.is_whitespace() || tick(c));
    (
        cleaned,
        cleaned != original && original.chars().any(|c| matches!(c, '✓' | '✔' | '✅')),
    )
}
fn finish(pending: Pending, good: &mut Vec<Question>, errors: &mut Vec<Value>) {
    let reject = |errors: &mut Vec<Value>, reason: &str| {
        errors.push(json!({"numero":pending.number,"motivo":reason}))
    };
    if pending.duplicate
        || pending.options.len() != 4
        || pending
            .options
            .values()
            .any(|value| value.trim().is_empty())
    {
        reject(
            errors,
            "Faltan opciones A-D, están vacías o hay una opción duplicada.",
        );
        return;
    }
    let mut hints = BTreeSet::new();
    let bold: Vec<char> = pending
        .styles
        .iter()
        .filter(|(_, s)| s.visible > 0 && s.bold * 5 >= s.visible * 4)
        .map(|(letter, _)| *letter)
        .collect();
    if bold.len() == 1 {
        hints.insert(bold[0]);
    } else if bold.len() > 1 && bold.len() < 4 {
        reject(
            errors,
            "Más de una respuesta destacada en negrita; indicador ambiguo.",
        );
        return;
    }
    let mut colors: BTreeMap<String, Vec<char>> = BTreeMap::new();
    for (letter, evidence) in &pending.styles {
        if evidence.tick {
            hints.insert(*letter);
        }
        if let Some(color) = evidence.color() {
            colors.entry(color).or_default().push(*letter);
        }
    }
    if colors.len() > 1 {
        let single: Vec<char> = colors
            .values()
            .filter(|letters| letters.len() == 1)
            .map(|letters| letters[0])
            .collect();
        if colors.len() == 2
            && single.len() == 1
            && colors.values().any(|letters| letters.len() == 3)
        {
            hints.insert(single[0]);
        } else {
            reject(
                errors,
                "Los colores de las opciones no identifican una única respuesta distinta del formato general.",
            );
            return;
        }
    }
    if hints.len() != 1 {
        reject(
            errors,
            if hints.is_empty() {
                "No hay respuesta correcta inequívoca: use negrita, color distintivo o una marca de verificación en una opción."
            } else {
                "Indicadores contradictorios: negrita, color o marcas señalan respuestas diferentes."
            },
        );
        return;
    }
    good.push(Question {
        number: pending.number,
        statement: pending.statement,
        options: pending.options,
        answer: *hints.first().expect("one answer"),
    });
}
pub(super) fn parse(lines: &[Line]) -> (Vec<Question>, Vec<Value>) {
    let (mut good, mut errors, mut current, mut delimiter) =
        (Vec::new(), Vec::new(), None::<Pending>, None);
    for line in lines {
        let text = line.text.trim();
        if let Some((number, statement)) = question_start(text) {
            let separator = text.chars().find(|c| !c.is_ascii_digit());
            let is_question = current
                .as_ref()
                .is_none_or(|q| separator == delimiter && number > q.number);
            if is_question {
                if let Some(previous) = current.take() {
                    finish(previous, &mut good, &mut errors);
                }
                delimiter = separator;
                current = Some(Pending {
                    number,
                    statement,
                    options: BTreeMap::new(),
                    styles: BTreeMap::new(),
                    last: None,
                    duplicate: false,
                });
                continue;
            }
        }
        let Some(pending) = current.as_mut() else {
            continue;
        };
        let (cleaned, leading_tick) = trim_tick(text);
        if let Some((letter, value)) = option_line(cleaned) {
            let (value, trailing_tick) = trim_tick(&value);
            pending.duplicate |= pending.options.insert(letter, value.to_owned()).is_some();
            pending.styles.entry(letter).or_default().add(
                line,
                value,
                leading_tick || trailing_tick,
            );
            pending.last = Some(letter);
        } else if let Some(letter) = pending.last {
            if !text.is_empty() {
                let (value, marked) = trim_tick(text);
                if !value.is_empty() {
                    let option = pending.options.get_mut(&letter).expect("last option");
                    option.push(' ');
                    option.push_str(value);
                }
                pending
                    .styles
                    .entry(letter)
                    .or_default()
                    .add(line, value, marked);
            }
        } else if !text.is_empty() {
            pending.statement.push(' ');
            pending.statement.push_str(text);
        }
    }
    if let Some(last) = current {
        finish(last, &mut good, &mut errors);
    }
    (good, errors)
}

#[cfg(test)]
mod tests {
    use super::*;
    fn document(bold: &[char], colors: &[(&str, char)], ticks: &[char]) -> Vec<Line> {
        let mut lines = vec![Line {
            text: "1. Pregunta de ensayo".into(),
            bold: false,
            color: None,
        }];
        for c in 'a'..='d' {
            lines.push(Line {
                text: format!(
                    "{c}. Respuesta {c}{}",
                    if ticks.contains(&c) { " ✓" } else { "" }
                ),
                bold: bold.contains(&c),
                color: colors
                    .iter()
                    .find(|(_, letter)| *letter == c)
                    .map(|(color, _)| (*color).into()),
            });
        }
        lines
    }
    #[test]
    fn recognizes_ticks_and_color_but_not_uniform_decoration() {
        for source in [
            document(&[], &[], &['c']),
            document(&[], &[("FF0000", 'b')], &[]),
            document(&['a', 'b', 'c', 'd'], &[], &['d']),
        ] {
            let (valid, errors) = parse(&source);
            assert_eq!(valid.len(), 1);
            assert!(errors.is_empty());
        }
        assert_eq!(parse(&document(&['a', 'b', 'c', 'd'], &[], &[])).1.len(), 1);
        assert_eq!(
            parse(&document(
                &[],
                &[
                    ("FF0000", 'a'),
                    ("FF0000", 'b'),
                    ("FF0000", 'c'),
                    ("FF0000", 'd')
                ],
                &[]
            ))
            .1
            .len(),
            1
        );
    }
    #[test]
    fn rejects_conflicting_ambiguous_and_missing_marks() {
        for source in [
            document(&['a'], &[], &['b']),
            document(&['a'], &[("FF0000", 'c')], &[]),
            document(&[], &[], &['a', 'b']),
            document(&['a', 'b'], &[], &[]),
            document(&[], &[], &[]),
        ] {
            let (valid, errors) = parse(&source);
            assert!(valid.is_empty());
            assert_eq!(errors.len(), 1);
            assert_eq!(errors[0]["numero"], 1);
        }
    }
    #[test]
    fn preserves_wrapped_answers_and_numbered_subclauses() {
        let mut source = document(&['b'], &[], &[]);
        source.insert(
            1,
            Line {
                text: "1) Primera condición".into(),
                bold: false,
                color: None,
            },
        );
        source.insert(
            2,
            Line {
                text: "2) Segunda condición".into(),
                bold: false,
                color: None,
            },
        );
        source.insert(
            5,
            Line {
                text: "continuación de respuesta".into(),
                bold: true,
                color: None,
            },
        );
        let (valid, errors) = parse(&source);
        assert!(errors.is_empty());
        assert_eq!(valid.len(), 1);
        assert!(valid[0].statement.contains("2) Segunda condición"));
        assert!(valid[0].options[&'b'].contains("continuación de respuesta"));
    }
    #[test]
    fn does_not_drop_a_missing_answer_when_later_questions_are_valid() {
        let mut source = document(&[], &[], &[]);
        let mut next = document(&['d'], &[], &[]);
        next[0].text = "2. Segunda pregunta".into();
        source.extend(next);
        let (valid, errors) = parse(&source);
        assert_eq!(valid.len(), 1);
        assert_eq!(valid[0].number, 2);
        assert_eq!(errors[0]["numero"], 1);
    }
}
