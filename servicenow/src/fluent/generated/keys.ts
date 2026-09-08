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
                    'dt-backfill-browser-monitor-01': {
                        table: 'cmdb_ci'
                        id: '53b16cc7072a49cc867020676c9ee8a3'
                    }
                    'dt-backfill-frontend-01': {
                        table: 'cmdb_ci_web_application'
                        id: '2121a2e59d6a48dabb641b5ef2ddfd35'
                    }
                    'dt-backfill-k8s-cluster-01': {
                        table: 'cmdb_ci_kubernetes_cluster'
                        id: 'eba2d84af6ce4bae84d681fed6b96eb3'
                    }
                    'dt-backfill-k8s-deployment-01': {
                        table: 'cmdb_ci_kubernetes_deployment'
                        id: '330d384203fe46f294fd07c16954967f'
                    }
                    'dt-backfill-k8s-deployment-02': {
                        table: 'cmdb_ci_kubernetes_deployment'
                        id: 'd87720207f1a416a89adebbe046d5581'
                    }
                    'dt-backfill-k8s-deployment-03': {
                        table: 'cmdb_ci_kubernetes_deployment'
                        id: 'c37edc5bf8c34c1bba149850e7983b2b'
                    }
                    'dt-backfill-k8s-deployment-04': {
                        table: 'cmdb_ci_kubernetes_deployment'
                        id: '5cbfbe0903164968be4fc0ab0fad0258'
                    }
                    'dt-backfill-k8s-deployment-05': {
                        table: 'cmdb_ci_kubernetes_deployment'
                        id: '8a0f89f6934c436ca151703a0895448a'
                    }
                    'dt-backfill-k8s-namespace-01': {
                        table: 'cmdb_ci_kubernetes_namespace'
                        id: '34b49d81983a41eba1ddaf485f5b236e'
                    }
                    'dt-backfill-k8s-namespace-02': {
                        table: 'cmdb_ci_kubernetes_namespace'
                        id: '1f58ac792dc0441ca056978b15de17e3'
                    }
                    'dt-backfill-k8s-namespace-03': {
                        table: 'cmdb_ci_kubernetes_namespace'
                        id: 'd5a352009d9c446294467ec5cb09c85c'
                    }
                    'dt-backfill-k8s-namespace-04': {
                        table: 'cmdb_ci_kubernetes_namespace'
                        id: 'ec5ef9d18cd3415eaf26128d12ac142f'
                    }
                    'dt-backfill-k8s-namespace-05': {
                        table: 'cmdb_ci_kubernetes_namespace'
                        id: '60f2d04d13b84762be2dc92054fb1223'
                    }
                    'dt-backfill-k8s-node-01': {
                        table: 'cmdb_ci_kubernetes_node'
                        id: '2274905a33824b31b5a3dd1aaf5e4c18'
                    }
                    'dt-backfill-k8s-node-02': {
                        table: 'cmdb_ci_kubernetes_node'
                        id: '9c0f76feeafc47dbaf784dbb1ef8b871'
                    }
                    'dt-backfill-k8s-pod-01': {
                        table: 'cmdb_ci_kubernetes_pod'
                        id: '404b24475e4f45118571b2403b2e12ef'
                    }
                    'dt-backfill-k8s-pod-02': {
                        table: 'cmdb_ci_kubernetes_pod'
                        id: '2354b7c40c5f4fdd8ebcfdecb1a8fd74'
                    }
                    'dt-backfill-k8s-pod-03': {
                        table: 'cmdb_ci_kubernetes_pod'
                        id: '22a3711c83d6423da07cf3ae2aa19407'
                    }
                    'dt-backfill-k8s-pod-04': {
                        table: 'cmdb_ci_kubernetes_pod'
                        id: '43a4cde8c93d4f43bbce8c2ef716e53d'
                    }
                    'dt-backfill-k8s-pod-05': {
                        table: 'cmdb_ci_kubernetes_pod'
                        id: 'e8e97fa9af414a98ad4df3acda355ba9'
                    }
                    'dt-backfill-k8s-pod-06': {
                        table: 'cmdb_ci_kubernetes_pod'
                        id: '9996ebbafdd64c7997bfafa9df7fd128'
                    }
                    'dt-backfill-k8s-pod-07': {
                        table: 'cmdb_ci_kubernetes_pod'
                        id: '2e98999cd319499a8dfa6b5af1d6c696'
                    }
                    'dt-backfill-k8s-pod-08': {
                        table: 'cmdb_ci_kubernetes_pod'
                        id: 'bba3742c4b0b458fa1b467b7d8a96369'
                    }
                    'dt-backfill-k8s-pod-09': {
                        table: 'cmdb_ci_kubernetes_pod'
                        id: '4bfd75ee54dd4f7988dd436986e225e3'
                    }
                    'dt-backfill-k8s-pod-10': {
                        table: 'cmdb_ci_kubernetes_pod'
                        id: '18ed4ecd482e4cbc989f66faa3386e8f'
                    }
                    'dt-backfill-k8s-pod-11': {
                        table: 'cmdb_ci_kubernetes_pod'
                        id: 'e388de62afb349e582ff759493c5cd16'
                    }
                    'dt-backfill-k8s-pod-12': {
                        table: 'cmdb_ci_kubernetes_pod'
                        id: '6d82acc3601747558c0da9ccc6dba49c'
                    }
                    'dt-backfill-k8s-pod-13': {
                        table: 'cmdb_ci_kubernetes_pod'
                        id: 'be98592d8cbd4849b29210b1f783f305'
                    }
                    'dt-backfill-k8s-pod-14': {
                        table: 'cmdb_ci_kubernetes_pod'
                        id: '3bcacb07267f469f96e7bc6d17ccdd1d'
                    }
                    'dt-backfill-k8s-pod-15': {
                        table: 'cmdb_ci_kubernetes_pod'
                        id: '6a8a1b414c474b1da5dd0bd8afecf17b'
                    }
                    'dt-backfill-k8s-pod-16': {
                        table: 'cmdb_ci_kubernetes_pod'
                        id: '77694c0e698042fb93c8eb54ea0f51cc'
                    }
                    'dt-backfill-k8s-pod-17': {
                        table: 'cmdb_ci_kubernetes_pod'
                        id: '1906ad44484e4a379a55c146a251ca0d'
                    }
                    'dt-backfill-k8s-pod-18': {
                        table: 'cmdb_ci_kubernetes_pod'
                        id: '8a8a3d53f7b1449f94bfcfe7d5558a4e'
                    }
                    'dt-backfill-k8s-pod-19': {
                        table: 'cmdb_ci_kubernetes_pod'
                        id: 'd808256989ac419ab1621dfadec3d648'
                    }
                    'dt-backfill-k8s-pod-20': {
                        table: 'cmdb_ci_kubernetes_pod'
                        id: '3b93abc948ef4d558b366bc8d62d81a2'
                    }
                    'dt-backfill-process-01': {
                        table: 'cmdb_ci_appl'
                        id: 'b8579ab574704e85ab7235a4ce28a7eb'
                    }
                    'dt-backfill-process-02': {
                        table: 'cmdb_ci_appl'
                        id: '860ccfcae0e34843bb4debbd67088b33'
                    }
                    'dt-backfill-process-03': {
                        table: 'cmdb_ci_appl'
                        id: 'b1a468c84c834bd89b9431c8cd92a7cc'
                    }
                    'dt-backfill-process-04': {
                        table: 'cmdb_ci_appl'
                        id: 'e9612b2d616d46a49dfc99d49babfd98'
                    }
                    'dt-backfill-process-05': {
                        table: 'cmdb_ci_appl'
                        id: '6f023b9532c54d98b7c80195d4b707c4'
                    }
                    'dt-backfill-process-06': {
                        table: 'cmdb_ci_appl'
                        id: '03df29a075fd4dceaa63a4576b10d713'
                    }
                    'dt-backfill-process-07': {
                        table: 'cmdb_ci_appl'
                        id: '50df6662b2ac40ea916b284968d16a6e'
                    }
                    'dt-backfill-process-08': {
                        table: 'cmdb_ci_appl'
                        id: '6d57a85385a44bb993418f1364050b2e'
                    }
                    'dt-backfill-process-09': {
                        table: 'cmdb_ci_appl'
                        id: '8bfb321d13b54c9ea9869f99cf9bfe5e'
                    }
                    'dt-backfill-process-10': {
                        table: 'cmdb_ci_appl'
                        id: '17c1085438fc44a8a06e1e5c4a7e47f9'
                    }
                    'dt-backfill-process-11': {
                        table: 'cmdb_ci_appl'
                        id: '8297f195b7aa4faf9fb5d8b1dc74ed5b'
                    }
                    'dt-backfill-process-12': {
                        table: 'cmdb_ci_appl'
                        id: '3359492925154d48b4e690be359f2bb3'
                    }
                    'dt-bind-ire-correlated': {
                        table: 'em_match_rule'
                        id: '924468bbd8004781b35ac5ee9ada0307'
                    }
                    'dt-bind-sgc-host': {
                        table: 'em_match_rule'
                        id: 'acbe8a2c8e6140158334a1be961882b2'
                    }
                    'dt-bind-sgc-process': {
                        table: 'em_match_rule'
                        id: '5910fd65b56e4b739f9305e250e351e0'
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
