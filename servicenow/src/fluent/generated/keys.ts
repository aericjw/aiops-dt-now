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
                    'dt-bind-ire-correlated': {
                        table: 'em_match_rule'
                        id: '924468bbd8004781b35ac5ee9ada0307'
                    }
                    'dt-bind-sgc-host': {
                        table: 'em_match_rule'
                        id: 'acbe8a2c8e6140158334a1be961882b2'
                    }
                    'dt-bind-sgc-service': {
                        table: 'em_match_rule'
                        id: 'c40c1fe9cbe5430682f3d90969cdb638'
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
