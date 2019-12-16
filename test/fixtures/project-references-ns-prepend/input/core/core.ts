// version numbers and helpers
namespace ns {
    export const versionMajorMinor = "3.8";
    export const version = `${versionMajorMinor}.0-dev`;
}
/** @internal */
namespace ns {
    export function coreHelper1() {
        return "ok";
    }

    export function coreHelper2() {
        return "ok";
    }
}

namespace ns {
    /** @internal */
    export function coreHelper3() {
        return "ok";
    }
} // end of ns
// file complete