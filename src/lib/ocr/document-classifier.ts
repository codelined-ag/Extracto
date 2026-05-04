export type DocumentTypeKind =
  | "invoice"
  | "receipt"
  | "contract"
  | "academic"
  | "form"
  | "id"
  | "generic";

export interface DocumentTypeClassification {
  kind: DocumentTypeKind;
  confidence: number;
}

const MIN_TEXT_CHARS = 80;
const HEAD_CHARS = 2500;

interface RuleSignal {
  kind: DocumentTypeKind;
  patterns: RegExp[];
  weight: number;
}

const RULES: RuleSignal[] = [
  {
    kind: "invoice",
    weight: 1,
    patterns: [
      /\binvoice\s*(?:no\.?|number|#)\b/i,
      /\binvoice\b/i,
      /\bbill\s*to\b/i,
      /\bsubtotal\b/i,
      /\btax\s+id\b/i,
      /\bpurchase\s+order\b/i,
      /\bnet\s+\d+\s+days?\b/i,
      /\bvat\s+(?:no\.?|number|id)\b/i,
    ],
  },
  {
    kind: "receipt",
    weight: 1,
    patterns: [
      /\breceipt\b/i,
      /\bcashier\b/i,
      /\bchange\s+due\b/i,
      /\bauth\s+code\b/i,
      /\bvisa|mastercard|amex\b/i,
      /\btendered\b/i,
      /\bthank\s+you\s+for\s+(?:your\s+)?(?:purchase|business)\b/i,
    ],
  },
  {
    kind: "contract",
    weight: 1,
    patterns: [
      /\b(?:this\s+)?agreement\b/i,
      /\bbetween\s+(?:the\s+parties|.{1,80}\sand\s)/i,
      /\bhereby\s+agree\b/i,
      /\bwhereas\b/i,
      /\bwitnesseth\b/i,
      /\bin\s+witness\s+whereof\b/i,
      /\beffective\s+date\b/i,
      /\bgoverning\s+law\b/i,
      /\bnon[-\s]disclosure\b/i,
    ],
  },
  {
    kind: "academic",
    weight: 1,
    patterns: [
      /\babstract\b\s*[:.\-]/i,
      /\bdoi\s*[:\s]\s*10\.\d{4,}/i,
      /\barxiv\s*[:.]\s*\d/i,
      /\breferences\s*$/im,
      /\bbibliography\s*$/im,
      /\bcite[d]?\s+as\b/i,
      /\bisbn\b/i,
      /\bpeer[-\s]review/i,
    ],
  },
  {
    kind: "id",
    weight: 1,
    patterns: [
      /\bpassport(?:\s+no\.?|\s+number)?\b/i,
      /\bdriver'?s?\s+licen[sc]e\b/i,
      /\bdate\s+of\s+birth\b/i,
      /\bplace\s+of\s+birth\b/i,
      /\bnationality\b/i,
      /\bissuing\s+(?:authority|country)\b/i,
      /\bid\s+card\b/i,
      /\bsex\s*[:\s]\s*[FM]\b/i,
    ],
  },
  {
    kind: "form",
    weight: 1,
    patterns: [
      /\bplease\s+(?:fill|complete|print)\b/i,
      /\bcheck\s+(?:one|all\s+that\s+apply)\b/i,
      /\bsignature\s*(?::|_{2,}|\bx\b)/i,
      /\bapplicant'?s?\s+(?:name|signature)\b/i,
      /\bsection\s+\d+\s+of\s+\d+\b/i,
      /\bform\s+(?:no\.?|number)\b/i,
    ],
  },
];

export function classifyDocumentType(firstPageText: string): DocumentTypeClassification {
  if (!firstPageText) return { kind: "generic", confidence: 0 };
  const head = firstPageText.slice(0, HEAD_CHARS);
  if (head.length < MIN_TEXT_CHARS) return { kind: "generic", confidence: 0 };

  const scores = new Map<DocumentTypeKind, number>();
  for (const rule of RULES) {
    let hits = 0;
    for (const pattern of rule.patterns) {
      if (pattern.test(head)) hits += 1;
    }
    if (hits > 0) {
      scores.set(rule.kind, (scores.get(rule.kind) ?? 0) + hits * rule.weight);
    }
  }
  if (scores.size === 0) return { kind: "generic", confidence: 0 };

  const ranked = [...scores.entries()].sort((a, b) => b[1] - a[1]);
  const [topKind, topScore] = ranked[0];
  const secondScore = ranked[1]?.[1] ?? 0;
  const confidence = Math.min(1, topScore / 4) - Math.min(0.4, secondScore / 8);
  if (confidence < 0.25) return { kind: "generic", confidence: 0 };
  return { kind: topKind, confidence: Number(confidence.toFixed(2)) };
}
