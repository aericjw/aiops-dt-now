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
                    'dt-action-fetch-logs': {
                        table: 'em_alert_man_m2m_rule_flow'
                        id: 'd3d916abb0e044598901fcf7881cd14c'
                    }
                    'dt-action-fetch-metrics': {
                        table: 'em_alert_man_m2m_rule_flow'
                        id: '7cf9b7245f8d41288059ba514a35a905'
                    }
                    'dt-action-open-problem': {
                        table: 'em_launch_application'
                        id: 'e337198f680147348e563f31f28c0031'
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
                    'dt-correlate-by-problem': {
                        table: 'em_alert_correlation_rule'
                        id: '0fe35d9505494e3c891966deaa7ae1ea'
                    }
                    'dt-fetch-logs-call': {
                        table: 'sys_hub_action_instance_v2'
                        id: 'aaad19d050db4ab9b9fca313e98a4001'
                    }
                    'dt-fetch-logs-lookup-alias': {
                        table: 'sys_hub_action_instance_v2'
                        id: 'e173aaea113945dc80c79c5d7305d4e1'
                    }
                    'dt-fetch-logs-lookup-alias-poll': {
                        table: 'sys_hub_action_instance_v2'
                        id: 'aa79a2ec37b84e9baefdf102d0d02354'
                    }
                    'dt-fetch-logs-poll': {
                        table: 'sys_hub_action_instance_v2'
                        id: '4e71ae82151d4320a520604eef5867fc'
                    }
                    'dt-fetch-logs-set-entity-id': {
                        table: 'sys_hub_flow_logic_instance_v2'
                        id: 'a9bb298397e04ecabefe027addff29ad'
                    }
                    'dt-fetch-logs-subflow': {
                        table: 'sys_hub_flow'
                        id: '49f8f6ccfe534830a08672bce3b2b39d'
                    }
                    'dt-fetch-logs-write-worknotes': {
                        table: 'sys_hub_action_instance_v2'
                        id: 'e4bd411f29824ce3848cebb393f257a8'
                    }
                    'dt-fetch-metrics-call': {
                        table: 'sys_hub_action_instance_v2'
                        id: '2b590ec9217f451d885e4bae17ef49e9'
                    }
                    'dt-fetch-metrics-lookup-alias': {
                        table: 'sys_hub_action_instance_v2'
                        id: '868a327e94d94f80b6699c6535b125b3'
                    }
                    'dt-fetch-metrics-lookup-alias-poll': {
                        table: 'sys_hub_action_instance_v2'
                        id: 'e6c758c08d7043d28c7806327e4e15a9'
                    }
                    'dt-fetch-metrics-poll': {
                        table: 'sys_hub_action_instance_v2'
                        id: 'c9a0e76125c642f2b2eb2ca45e500f96'
                    }
                    'dt-fetch-metrics-set-entity-id': {
                        table: 'sys_hub_flow_logic_instance_v2'
                        id: '6f06f24ca69f42dcba62351e8b1b9e6c'
                    }
                    'dt-fetch-metrics-subflow': {
                        table: 'sys_hub_flow'
                        id: 'e641691909e240c180166a8b20f8bb4e'
                    }
                    'dt-fetch-metrics-write-worknotes': {
                        table: 'sys_hub_action_instance_v2'
                        id: '2159ca8045dd478d8b439fbc7290afa0'
                    }
                    'dt-incident-template': {
                        table: 'em_incident_template'
                        id: '73f45376639c419c8d2503fa91d4f4f5'
                    }
                    'dt-now-assist-skill': {
                        table: 'sn_aia_agent'
                        id: '2cfa0bafda1d43c4b529e69bffd39742'
                    }
                    'dt-now-assist-skill-acl': {
                        table: 'sys_security_acl'
                        id: '3f8b3a68899d4890ba0a555d08ec8756'
                    }
                    'dt-promote-primary-to-incident': {
                        table: 'em_alert_management_rule'
                        id: '434ad54010874dc1b868e66325a6ac64'
                    }
                    'dt-telemetry-rule': {
                        table: 'em_alert_management_rule'
                        id: '0b1fed0416664fed8727522cca7455e6'
                    }
                    package_json: {
                        table: 'sys_module'
                        id: 'edbec6b922a64d8899c9c1f9b5a3a9f1'
                    }
                }
                composite: [
                    {
                        table: 'sys_documentation'
                        id: '02e3802d8606424495c82c76ee6d8074'
                        key: {
                            name: 'var__m_sys_hub_flow_input_49f8f6ccfe534830a08672bce3b2b39d'
                            element: 'executionId'
                            language: 'en'
                        }
                    },
                    {
                        table: 'sys_agent_access_role_mapping'
                        id: '0452a94e221d4f1ab943d8e5ae8d26db'
                        key: {
                            agent_access_config: {
                                id: 'bc7e89f2764742d096a06a6f0d1c2898'
                                key: {
                                    agent: '2cfa0bafda1d43c4b529e69bffd39742'
                                }
                            }
                            role: {
                                id: '32786539d0694baa90508fd174bdd815'
                                key: {
                                    name: 'itil'
                                }
                            }
                        }
                    },
                    {
                        table: 'sys_hub_flow_input'
                        id: '049dede9d94740969c53455a29215c12'
                        key: {
                            model: '49f8f6ccfe534830a08672bce3b2b39d'
                            element: 'executionId'
                        }
                    },
                    {
                        table: 'sn_aia_version'
                        id: '283d48c2fa3c49ce93fd2d75c3a85269'
                        key: {
                            target_id: '2cfa0bafda1d43c4b529e69bffd39742'
                            version_name: 'V1'
                        }
                    },
                    {
                        table: 'sys_hub_flow_input'
                        id: '28d181b2c9b443e9b3b715045686f8b2'
                        key: {
                            model: '49f8f6ccfe534830a08672bce3b2b39d'
                            element: 'userName'
                        }
                    },
                    {
                        table: 'sys_documentation'
                        id: '34e814de48de40cd8e4080e1569a69bb'
                        key: {
                            name: 'var__m_sys_hub_flow_input_49f8f6ccfe534830a08672bce3b2b39d'
                            element: 'alertGR'
                            language: 'en'
                        }
                    },
                    {
                        table: 'sn_aia_tool'
                        id: '416c38d30d6e40949f910e37a7a00d22'
                        key: {
                            name: 'Fetch Dynatrace Metrics'
                        }
                    },
                    {
                        table: 'sys_hub_flow_variable'
                        id: '42cd5ac1525849149f8ee7225b8a9b16'
                        key: {
                            model: 'e641691909e240c180166a8b20f8bb4e'
                            element: 'entityId'
                        }
                    },
                    {
                        table: 'sys_hub_flow_input'
                        id: '44408805a11041d2be498585b643bc2e'
                        key: {
                            model: '49f8f6ccfe534830a08672bce3b2b39d'
                            element: 'userDisplayName'
                        }
                    },
                    {
                        table: 'sn_aia_agent_tool_m2m'
                        id: '4cd235d2d19e41ceb19baf2f3f04cfca'
                        key: {
                            agent: '2cfa0bafda1d43c4b529e69bffd39742'
                            tool: '416c38d30d6e40949f910e37a7a00d22'
                            name: 'Fetch Dynatrace Metrics'
                        }
                    },
                    {
                        table: 'sn_aia_tool'
                        id: '50bb0146d1004aceb6cec5806d2b38b2'
                        key: {
                            name: 'Look Up Dynatrace Alert'
                        }
                    },
                    {
                        table: 'sys_documentation'
                        id: '56c69f16695b4b2d82050121a0194226'
                        key: {
                            name: 'var__m_sys_hub_flow_input_49f8f6ccfe534830a08672bce3b2b39d'
                            element: 'userDisplayName'
                            language: 'en'
                        }
                    },
                    {
                        table: 'sys_documentation'
                        id: '6118c64c83aa49e78fa20b05316ffe79'
                        key: {
                            name: 'var__m_sys_hub_flow_variable_49f8f6ccfe534830a08672bce3b2b39d'
                            element: 'entityId'
                            language: 'en'
                        }
                    },
                    {
                        table: 'sys_documentation'
                        id: '6295e3bfbcfa41df82d94250af82038a'
                        key: {
                            name: 'var__m_sys_hub_flow_input_e641691909e240c180166a8b20f8bb4e'
                            element: 'alertRuleName'
                            language: 'en'
                        }
                    },
                    {
                        table: 'sn_aia_agent_tool_m2m'
                        id: '7438d8e2b3744f10ada1526057573eb8'
                        key: {
                            agent: '2cfa0bafda1d43c4b529e69bffd39742'
                            tool: '50bb0146d1004aceb6cec5806d2b38b2'
                            name: 'Look Up Dynatrace Alert'
                        }
                    },
                    {
                        table: 'sys_hub_flow_input'
                        id: '7783949b2a9845d4840733963c5a0524'
                        key: {
                            model: 'e641691909e240c180166a8b20f8bb4e'
                            element: 'userDisplayName'
                        }
                    },
                    {
                        table: 'sys_hub_flow_input'
                        id: '79bcda95277e4248817498609ac577f5'
                        key: {
                            model: '49f8f6ccfe534830a08672bce3b2b39d'
                            element: 'alertRuleId'
                        }
                    },
                    {
                        table: 'sys_documentation'
                        id: '896de8f79e704de1978278531a6dcd95'
                        key: {
                            name: 'var__m_sys_hub_flow_input_49f8f6ccfe534830a08672bce3b2b39d'
                            element: 'alertRuleId'
                            language: 'en'
                        }
                    },
                    {
                        table: 'sys_documentation'
                        id: '89c530bcfff1454084dc3825834222f8'
                        key: {
                            name: 'var__m_sys_hub_flow_input_e641691909e240c180166a8b20f8bb4e'
                            element: 'alertRuleId'
                            language: 'en'
                        }
                    },
                    {
                        table: 'sys_hub_flow_input'
                        id: '8aa70f87922d4fa2a225983b9948b5b1'
                        key: {
                            model: 'e641691909e240c180166a8b20f8bb4e'
                            element: 'userName'
                        }
                    },
                    {
                        table: 'sys_documentation'
                        id: 'a2438e16609a4705bd77d2f434693e82'
                        key: {
                            name: 'var__m_sys_hub_flow_input_49f8f6ccfe534830a08672bce3b2b39d'
                            element: 'alertRuleName'
                            language: 'en'
                        }
                    },
                    {
                        table: 'sn_aia_agent_tool_m2m'
                        id: 'a2537566b5b9462483bccf26fdae6a77'
                        key: {
                            agent: '2cfa0bafda1d43c4b529e69bffd39742'
                            tool: 'cf141b32798649ac92e097e1cf1e7d59'
                            name: 'Fetch Dynatrace Logs'
                        }
                    },
                    {
                        table: 'sys_documentation'
                        id: 'ae36b9a5c6624282b5f3db842e01b374'
                        key: {
                            name: 'var__m_sys_hub_flow_input_e641691909e240c180166a8b20f8bb4e'
                            element: 'alertGR'
                            language: 'en'
                        }
                    },
                    {
                        table: 'sys_documentation'
                        id: 'b6d10948ca894c3fa6a11ed5f8746597'
                        key: {
                            name: 'var__m_sys_hub_flow_input_e641691909e240c180166a8b20f8bb4e'
                            element: 'userName'
                            language: 'en'
                        }
                    },
                    {
                        table: 'sys_hub_flow_input'
                        id: 'b8e803f855354b7ba1300be179a380bf'
                        key: {
                            model: 'e641691909e240c180166a8b20f8bb4e'
                            element: 'alertRuleName'
                        }
                    },
                    {
                        table: 'sys_agent_access_role_configuration'
                        id: 'bc7e89f2764742d096a06a6f0d1c2898'
                        key: {
                            agent: '2cfa0bafda1d43c4b529e69bffd39742'
                        }
                    },
                    {
                        table: 'sys_hub_flow_input'
                        id: 'be5926ebae8445d09ac0d084a887a541'
                        key: {
                            model: 'e641691909e240c180166a8b20f8bb4e'
                            element: 'alertGR'
                        }
                    },
                    {
                        table: 'sys_security_acl_role'
                        id: 'c3502230a5204ae38bd79bc7a315efaa'
                        key: {
                            sys_security_acl: '3f8b3a68899d4890ba0a555d08ec8756'
                            sys_user_role: '282bf1fac6112285017366cb5f867469'
                        }
                    },
                    {
                        table: 'sn_aia_tool'
                        id: 'cf141b32798649ac92e097e1cf1e7d59'
                        key: {
                            name: 'Fetch Dynatrace Logs'
                        }
                    },
                    {
                        table: 'sys_hub_flow_input'
                        id: 'd029b0d9215a451396330fa3539a75c0'
                        key: {
                            model: 'e641691909e240c180166a8b20f8bb4e'
                            element: 'executionId'
                        }
                    },
                    {
                        table: 'sys_hub_flow_input'
                        id: 'd20bb69a0ae54b2b9e7474849d955c19'
                        key: {
                            model: 'e641691909e240c180166a8b20f8bb4e'
                            element: 'alertRuleId'
                        }
                    },
                    {
                        table: 'sn_aia_agent_config'
                        id: 'd895598026ba456ab8dab26c19a235b4'
                        key: {
                            agent: '2cfa0bafda1d43c4b529e69bffd39742'
                        }
                    },
                    {
                        table: 'sys_hub_flow_variable'
                        id: 'dd69471172d04eaf8de7959b5ec5e02e'
                        key: {
                            model: '49f8f6ccfe534830a08672bce3b2b39d'
                            element: 'entityId'
                        }
                    },
                    {
                        table: 'sys_hub_flow_input'
                        id: 'de62afdc181d44ddb1e2752be8f33893'
                        key: {
                            model: '49f8f6ccfe534830a08672bce3b2b39d'
                            element: 'alertRuleName'
                        }
                    },
                    {
                        table: 'sys_documentation'
                        id: 'e73eaabf637c439fbe10ab29d900e64d'
                        key: {
                            name: 'var__m_sys_hub_flow_input_e641691909e240c180166a8b20f8bb4e'
                            element: 'executionId'
                            language: 'en'
                        }
                    },
                    {
                        table: 'sys_documentation'
                        id: 'e819519e7c894cb680a9e0acc91cfb46'
                        key: {
                            name: 'var__m_sys_hub_flow_input_49f8f6ccfe534830a08672bce3b2b39d'
                            element: 'userName'
                            language: 'en'
                        }
                    },
                    {
                        table: 'sys_hub_flow_input'
                        id: 'f1235c8a22314271a20401fe6deb5173'
                        key: {
                            model: '49f8f6ccfe534830a08672bce3b2b39d'
                            element: 'alertGR'
                        }
                    },
                    {
                        table: 'sys_documentation'
                        id: 'f9c8eb0042e54a9d90ef45ca975ebbd1'
                        key: {
                            name: 'var__m_sys_hub_flow_input_e641691909e240c180166a8b20f8bb4e'
                            element: 'userDisplayName'
                            language: 'en'
                        }
                    },
                    {
                        table: 'sys_documentation'
                        id: 'fe832ef877314c7a93a972f6cea1a061'
                        key: {
                            name: 'var__m_sys_hub_flow_variable_e641691909e240c180166a8b20f8bb4e'
                            element: 'entityId'
                            language: 'en'
                        }
                    },
                ]
            }
        }
    }
}
