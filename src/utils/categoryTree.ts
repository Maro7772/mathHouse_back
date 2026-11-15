type TreeNode = { id: string; parentCategoryId: string | null };

/**
 * Parents of `start`, nearest first. Stops at a missing parent or at a loop
 * (A → B → A), so bad data in the category table can never hang the server.
 */
export function ancestorsOf<T extends TreeNode>(start: T, byId: Map<string, T>): T[] {
    const out: T[] = [];
    const seen = new Set<string>([start.id]);
    let current = start;
    while (current.parentCategoryId) {
        const parent = byId.get(current.parentCategoryId);
        if (!parent || seen.has(parent.id)) break;
        seen.add(parent.id);
        out.push(parent);
        current = parent;
    }
    return out;
}
