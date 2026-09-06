import '@servicenow/sdk/global'

declare global {
    namespace Now {
        namespace Internal {
            interface Keys extends KeysRegistry {
                explicit: {
                    bom_json: {
                        table: 'sys_module'
                        id: 'ff20189aca094a2bb7f4063e81de638c'
                    }
                    package_json: {
                        table: 'sys_module'
                        id: 'edbec6b922a64d8899c9c1f9b5a3a9f1'
                    }
                }
            }
        }
    }
}
