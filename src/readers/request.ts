// Requests for files: this SharePoint only (nothing is sent elsewhere); dates from the file's own response

// ===========================================================================
// CONSTANTS
// ===========================================================================

export const OUTSIDE = 'Not opened: the link points outside this SharePoint';

// ===========================================================================
// METHODS
// ===========================================================================

/** @param url relative or absolute @returns on this SharePoint */
export const sameOrigin = (url: string): boolean => new URL(url, location.href).origin === location.origin;

// Dates from file's own response headers
/** @param cd Content-Disposition */
export function responseDates(response: Response, cd: string): { modified: string | null; created: string | null } {
    const iso = (v?: string) => {
        const d = v ? new Date(v.replace(/^"|"$/g, '')) : null;
        // "2026-10-24 08:35:13 UTC" (list dates are local time, so UTC is named)
        return d && !Number.isNaN(d.getTime()) ? `${d.toISOString().slice(0, 19).replace('T', ' ')} UTC` : null;
    };
    return {
        modified: iso(response.headers.get('last-modified') || (cd.match(/modification-date="?([^";]+)/i) || [])[1]),
        created: iso((cd.match(/creation-date="?([^";]+)/i) || [])[1]),
    };
}
