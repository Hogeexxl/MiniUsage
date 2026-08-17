                    status: TurnEndStatus::Completed,
                },
            ]);
        assert_eq!(after_new_baseline.events.len(), 1);
        assert_eq!(after_new_baseline.events[0].kind, EventKind::Recovered);
        assert!(
            after_new_baseline.closed_turns[0]
                .turn
                .start_total
                .is_some()
        );
        assert!(after_new_baseline.closed_turns[0].turn.blocks.allowed());
    }

    #[test]
    fn t_mu03_c03_effort_is_canonical_identity_but_not_derived_cost() {
        let records = vec![
            UsageRecord::TurnContext {
                ownership: owning(),
                model: Some("model-a".to_owned()),
                reasoning_effort: Some("high".to_owned()),
            },
            token(
                100,
                10,
                known(10, 2, 1, 4, 1),
                UsageValue::Valid(known(3, 1, 0, 2, 1)),
            ),
        ];
        let high = UsageProcessor::new(context(1), None)
            .process(records)
            .events
            .pop()
            .expect("canonical event");
        let mut medium = high.clone();
        medium.reasoning_effort = Some("medium".to_owned());
        medium.event_id = event_id(&medium);

        assert_eq!(
            crate::usage::canonical_algorithm_for(crate::usage::USAGE_PARSER_VERSION),
            Some(5)
        );
        assert_eq!(crate::usage::USAGE_PARSER_VERSION, 7);
        assert_eq!(crate::usage::USAGE_CANONICAL_ALGORITHM_VERSION, 5);
        assert_eq!(high.event_id, event_id(&high), "replay is stable");
        assert_ne!(
            high.event_id, medium.event_id,
            "effort is canonical context"
        );
        assert_eq!(
            compare_canonical(Some(&high), &high),
            CanonicalDecision::Duplicate
        );
        assert_eq!(
            compare_canonical(Some(&high), &medium),
            CanonicalDecision::Conflict
        );
    }

    #[test]
    fn t_mu03_c04_compensation_protects_effort_ownership_without_changing_tokens() {
        let baseline = known(10, 2, 1, 4, 1);
        let process = |contexts: &[Option<&str>]| {
            let mut records = vec![UsageRecord::TurnStarted {
                ownership: owning(),
                turn_id: Some("turn-effort".to_owned()),