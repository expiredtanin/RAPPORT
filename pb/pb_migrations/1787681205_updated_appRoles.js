/// <reference path="../pb_data/types.d.ts" />
migrate((app) => {
  const collection = app.findCollectionByNameOrId("pbc_1874463841")

  // update collection data
  unmarshal({
    "createRule": "@request.auth.id != '' && studio.studioMembers_via_studio.user ?= @request.auth.id && studio.studioMembers_via_studio.active = true && studio.studioMembers_via_studio.appRoleId ?= \"r-admin\"",
    "deleteRule": "@request.auth.id != '' && studio.studioMembers_via_studio.user ?= @request.auth.id && studio.studioMembers_via_studio.active = true && studio.studioMembers_via_studio.appRoleId ?= \"r-admin\"",
    "updateRule": "@request.auth.id != '' && studio.studioMembers_via_studio.user ?= @request.auth.id && studio.studioMembers_via_studio.active = true && studio.studioMembers_via_studio.appRoleId ?= \"r-admin\""
  }, collection)

  return app.save(collection)
}, (app) => {
  const collection = app.findCollectionByNameOrId("pbc_1874463841")

  // update collection data
  unmarshal({
    "createRule": "@request.auth.id != '' && studio.studioMembers_via_studio.user ?= @request.auth.id && studio.studioMembers_via_studio.active = true",
    "deleteRule": "@request.auth.id != '' && studio.studioMembers_via_studio.user ?= @request.auth.id && studio.studioMembers_via_studio.active = true",
    "updateRule": "@request.auth.id != '' && studio.studioMembers_via_studio.user ?= @request.auth.id && studio.studioMembers_via_studio.active = true"
  }, collection)

  return app.save(collection)
})
