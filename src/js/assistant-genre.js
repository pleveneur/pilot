// assistant-genre.js — LE GENRE DE L'ASSISTANT côté fenêtre (tâche 402).
//
// Rôle unique : donner au réglage (Options ⚙️ → onglet « Assistant » → « Genre
// de l'assistant ») ses TROIS valeurs, son libellé lisible et une
// normalisation tolérante. Le texte injecté dans le prompt, lui, ne vient
// JAMAIS d'ici : il est décidé en Rust, à un seul endroit
// (`assistant_identity::assistant_gender_instruction`), pour qu'il n'existe
// qu'une seule source de vérité de la phrase de genre.
//
// Règle de sûreté : une valeur inconnue n'impose AUCUN genre (elle est ramenée
// à « non précisé »), donc aucune phrase n'est ajoutée au prompt et le
// comportement reste celui d'avant ce lot.
//
// Aucun DOM, aucun import Tauri : décisions pures, testables.

/**
 * Clé de configuration du genre de l'Assistant. Cette clé est le SEUL réglage
 * de genre : le personnage actif (Présences) en porte un de son côté, dans sa
 * fiche, et il passe avant (voir `assistant_identity.rs`).
 */
export const ASSISTANT_GENDER_KEY = 'assistant_gender';

/** Valeur « non précisé » : aucune phrase de genre n'est ajoutée au prompt. */
export const ASSISTANT_GENDER_NONE = '';

/** Valeur canonique du féminin (ce qui est écrit dans la configuration). */
export const ASSISTANT_GENDER_FEMININE = 'feminin';

/** Valeur canonique du masculin (ce qui est écrit dans la configuration). */
export const ASSISTANT_GENDER_MASCULINE = 'masculin';

/**
 * Les trois choix de l'interface, dans l'ordre d'affichage. `label` est le
 * libellé lu par l'utilisateur ; il dit toujours ce que fait le choix par
 * défaut (« Aucune indication »), pour qu'on n'ait pas à le deviner.
 */
export const ASSISTANT_GENDER_OPTIONS = Object.freeze([
    { value: ASSISTANT_GENDER_NONE, label: "Non précisé (aucune indication)" },
    { value: ASSISTANT_GENDER_FEMININE, label: 'Féminin' },
    { value: ASSISTANT_GENDER_MASCULINE, label: 'Masculin' },
]);

/** Retire accents et casse : « Féminin », « FEMININ » et « feminin » se valent. */
function foldSpoken(value) {
    return String(value == null ? '' : value)
        .trim()
        .toLowerCase()
        .normalize('NFD')
        .replace(/[\u0300-\u036f]/g, '');
}

/**
 * Ramène n'importe quelle valeur lue (configuration, ancien réglage, saisie) à
 * l'une des trois valeurs canoniques. Une valeur absente ou inconnue devient
 * `''` — jamais une erreur, jamais un genre imposé.
 */
export function normalizeAssistantGender(value) {
    const plat = foldSpoken(value);
    if (plat === ASSISTANT_GENDER_FEMININE || plat === 'feminine' || plat === 'femme') {
        return ASSISTANT_GENDER_FEMININE;
    }
    if (plat === ASSISTANT_GENDER_MASCULINE || plat === 'masculine' || plat === 'homme') {
        return ASSISTANT_GENDER_MASCULINE;
    }
    return ASSISTANT_GENDER_NONE;
}

/** Vrai quand aucun genre n'est réglé (donc : prompt strictement inchangé). */
export function assistantGenderIsUnspecified(value) {
    return normalizeAssistantGender(value) === ASSISTANT_GENDER_NONE;
}

/** Libellé lisible d'une valeur (pour un résumé ou une infobulle). */
export function assistantGenderLabel(value) {
    const canonique = normalizeAssistantGender(value);
    const option = ASSISTANT_GENDER_OPTIONS.find((o) => o.value === canonique);
    return option ? option.label : ASSISTANT_GENDER_OPTIONS[0].label;
}

/**
 * Valeur à enregistrer quand le champ d'interface est lu (un `<select>`), et
 * valeur à réinjecter dans le champ quand on ouvre les Options. Un aller-retour
 * ne perd jamais une valeur : ce que `decideAssistantGenderValue` rend se relit
 * à l'identique.
 */
export function decideAssistantGenderValue(value) {
    return normalizeAssistantGender(value);
}
