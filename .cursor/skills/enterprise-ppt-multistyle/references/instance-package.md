# Instance package

An instance package is supplied by the user or an authorized local deployment. Keep it separate from the framework runtime and do not commit confidential material to the framework repository.

At this bootstrap stage, the package is documentation-only. Later tasks may define versioned schemas, validation, capability discovery, and approval boundaries. Until then, consumers should use only the runtime commands explicitly exposed by `npm run ppt-skill -- help`.
